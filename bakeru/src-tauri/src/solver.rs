use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};

pub static CANCEL_FLAG: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SolverInput {
    pub width: usize,
    pub height: usize,
    pub grid: Vec<u8>,
    pub goal: u8,
    pub shapes: Vec<ShapeData>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShapeData {
    pub id: usize,
    pub points: Vec<usize>,
}

#[derive(Debug, Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct SolutionStep {
    pub original_shape_id: usize,
    pub placement_x: usize,
    pub placement_y: usize,
    pub placement_seq: usize,
}

#[derive(Clone)]
struct Shape {
    original_id: usize,
    npts: usize,
    ax: usize,
    tot: usize,
    cache: Vec<usize>,
    seq: usize,
    incs: i32,
    equivalent_to: Option<usize>,
}

pub struct Solver {
    max_token: i32,
    mat: Vec<i8>,
    shapes: Vec<Shape>,
    ns: usize,
}

impl Solver {
    pub fn new(input: SolverInput) -> Result<Self, String> {
        let x = input.width;
        let y = input.height;
        let lt = input.grid.iter().copied().max().unwrap_or(0) as i32;
        let mt = lt + 1;
        let goal = input.goal as i32;
        let mut new_order = vec![0i32; mt as usize];
        for i in 0..mt {
            new_order[i as usize] = if i <= goal { goal - i } else { goal + mt - i };
        }
        let mat: Vec<i8> = input.grid.iter().map(|&v| new_order[v as usize] as i8).collect();
        let ns = input.shapes.len();
        if ns == 0 { return Err("No shapes".to_string()); }

        let mut work: Vec<(usize, Vec<usize>)> = input.shapes.iter().map(|s| (s.id, s.points.clone())).collect();
        let mut shapes: Vec<Shape> = Vec::with_capacity(ns);
        let mut togs = 0i32;

        for i in (0..ns).rev() {
            let mut best = 0;
            for j in 0..=i {
                if work[j].1.len() > work[best].1.len() { best = j; }
            }
            let (orig_id, mut pts) = work.swap_remove(best);
            pts.sort_unstable();
            togs += pts.len() as i32;

            let mut max_x = 0;
            let mut max_y = 0;
            for &p in &pts {
                max_x = max_x.max(p % x);
                max_y = max_y.max(p / x);
            }
            let ax = x - max_x;
            let ay = y - max_y;
            let tot = ax * ay;
            let mut cache = Vec::with_capacity(tot * pts.len());
            for k in 0..tot {
                let dx = k % ax;
                let dy = k / ax;
                for &pt in &pts {
                    cache.push((pt / x + dy) * x + (pt % x + dx));
                }
            }

            let mut eq_to = None;
            for (idx, prev) in shapes.iter().enumerate() {
                if prev.npts == pts.len() && prev.tot == tot && prev.cache[..prev.npts] == cache[..prev.npts] {
                    eq_to = Some(idx);
                    break;
                }
            }

            shapes.push(Shape {
                original_id: orig_id,
                npts: pts.len(),
                ax, tot, cache,
                seq: 0, incs: 0,
                equivalent_to: eq_to,
            });
        }

        let grid_sum: i32 = mat.iter().map(|&v| v as i32).sum();
        shapes[0].incs = (togs - grid_sum) / mt;

        Ok(Solver { max_token: mt, mat, shapes, ns })
    }

    pub fn solve(&mut self) -> Option<Vec<SolutionStep>> {
        CANCEL_FLAG.store(false, Ordering::SeqCst);
        let ns = self.ns;
        let mt = self.max_token as i8;
        let mut i = 0; 
        
        let mat_ptr = self.mat.as_mut_ptr();
        let shapes_ptr = self.shapes.as_mut_ptr();

        let mut budget_stack = [0i32; 256];
        unsafe { budget_stack[0] = (*shapes_ptr).incs; }

        let mut iter_count = 0;

        loop {
            iter_count += 1;
            if iter_count % 1024 == 0 && CANCEL_FLAG.load(Ordering::Relaxed) {
                return None;
            }

            let (npts, tot, seq, cache_ptr, i_budget) = unsafe {
                let shape = &*shapes_ptr.add(i);
                (shape.npts, shape.tot, shape.seq, shape.cache.as_ptr(), budget_stack[i])
            };

            let mut ok = false;
            for s in seq..tot {
                let tci = s * npts;
                let mut ti = i_budget;
                let mut can_place = true;
                
                unsafe {
                    let pts_start = cache_ptr.add(tci);
                    for j in 0..npts {
                        let mi = *pts_start.add(j);
                        if *mat_ptr.add(mi) == 0 {
                            ti -= 1;
                            if ti < 0 {
                                can_place = false;
                                break;
                            }
                        }
                    }

                    if can_place {
                        let shape_mut = &mut *shapes_ptr.add(i);
                        shape_mut.seq = s;
                        budget_stack[i + 1] = ti;

                        let pts_apply = cache_ptr.add(tci);
                        for j in 0..npts {
                            let mi = *pts_apply.add(j);
                            let val_ptr = mat_ptr.add(mi);
                            let mut v = *val_ptr - 1;
                            if v < 0 { v = mt - 1; }
                            *val_ptr = v;
                        }
                        ok = true;
                    }
                }
                if ok { break; }
            }

            if ok {
                if i == ns - 1 { return Some(self.build_solution()); }
                i += 1;
                unsafe {
                    let next_shape = &mut *shapes_ptr.add(i);
                    let eq_seq = next_shape.equivalent_to.map(|ei| (*shapes_ptr.add(ei)).seq).unwrap_or(0);
                    next_shape.seq = eq_seq;
                }
            } else {
                if i == 0 { return None; }
                i -= 1;
                
                unsafe {
                    let prev_shape = &mut *shapes_ptr.add(i);
                    let p_seq = prev_shape.seq;
                    let p_npts = prev_shape.npts;
                    let p_cache = prev_shape.cache.as_ptr().add(p_seq * p_npts);
                    
                    for j in 0..p_npts {
                        let mi = *p_cache.add(j);
                        let val_ptr = mat_ptr.add(mi);
                        let mut v = *val_ptr + 1;
                        if v == mt { v = 0; }
                        *val_ptr = v;
                    }
                    prev_shape.seq += 1;
                }
            }
        }
    }

    fn build_solution(&self) -> Vec<SolutionStep> {
        let mut steps = Vec::with_capacity(self.ns);
        for m in 0..self.ns {
            if let Some(s) = self.shapes.iter().find(|s| s.original_id == m) {
                steps.push(SolutionStep {
                    original_shape_id: s.original_id,
                    placement_x: s.seq % s.ax,
                    placement_y: s.seq / s.ax,
                    placement_seq: s.seq,
                });
            }
        }
        steps
    }
}

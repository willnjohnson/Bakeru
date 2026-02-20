
mod solver;

use solver::{Solver, SolverInput, SolutionStep};

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
async fn solve_puzzle(input: SolverInput) -> Option<Vec<SolutionStep>> {
    tauri::async_runtime::spawn_blocking(move || {
        match Solver::new(input) {
            Ok(mut s) => s.solve(),
            Err(e) => {
                println!("Solver error: {}", e);
                None
            }
        }
    }).await.unwrap_or(None)
}

#[tauri::command]
fn cancel_solve() {
    solver::CANCEL_FLAG.store(true, std::sync::atomic::Ordering::SeqCst);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, solve_puzzle, cancel_solve])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

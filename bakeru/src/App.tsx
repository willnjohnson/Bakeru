
import { useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";
import { parseHTML, PuzzleData } from "./utils";

interface SolutionStep {
  originalShapeId: number;
  placementSeq: number;
  placementX: number;
  placementY: number;
}

const VALUE_COLORS = [
  "#2E8B57", // Deep Sea Green
  "#B22222", // Firebrick Red
  "#FF8C00", // Dark Orange
  "#4682B4", // Steel Blue
  "#8B008B", // Dark Magenta
];
const COLOR_GRAY = "#555";

function App() {
  const [htmlInput, setHtmlInput] = useState("");
  const [status, setStatus] = useState("");
  const [cols, setCols] = useState(0);
  const [solutionSteps, setSolutionSteps] = useState<SolutionStep[]>([]);
  const [activeStepIndex, setActiveStepIndex] = useState(-1);
  const [maxToken, setMaxToken] = useState(3);
  const [goal, setGoal] = useState(0);
  const [highlights, setHighlights] = useState<number[]>([]);
  const [currentBoard, setCurrentBoard] = useState<number[] | null>(null);
  const [puzzleData, setPuzzleData] = useState<PuzzleData | null>(null);
  const [isSolving, setIsSolving] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const timerRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);



  function remapValue(raw: number, goalIdx: number, mt: number): number {
    // Logic matching the Rust solver's interpretation
    return raw <= goalIdx ? goalIdx - raw : goalIdx + mt - raw;
  }

  function formatTime(ms: number) {
    const seconds = (ms / 1000).toFixed(2);
    return `${seconds}s`;
  }

  async function handleSolve() {
    if (isSolving) {
      await invoke("cancel_solve");
      setStatus("Stopping...");
      return;
    }

    setStatus("Parsing...");
    setSolutionSteps([]);
    setActiveStepIndex(-1);
    setHighlights([]);
    setElapsedTime(0);
    setIsSolving(true);
    setCurrentBoard(null);
    startTimeRef.current = performance.now();

    timerRef.current = window.setInterval(() => {
      setElapsedTime(performance.now() - startTimeRef.current);
    }, 50);

    try {
      const data = parseHTML(htmlInput);
      setPuzzleData(data);
      setCols(data.width);
      setGoal(data.goal);

      const maxVal = Math.max(...data.grid);
      const mt = maxVal + 1;
      setMaxToken(mt);

      setStatus("Solving... (｡-ᆺ-｡) ᶻ 𝗓 𐰁");

      const result = await invoke<SolutionStep[]>("solve_puzzle", {
        input: {
          width: data.width,
          height: data.height,
          grid: data.grid,
          goal: data.goal,
          shapes: data.shapes
        }
      });

      if (result && result.length > 0) {
        const finalTime = performance.now() - startTimeRef.current;
        setStatus(`Found solution in ${result.length} step(s) with elapsed time of ${formatTime(finalTime)}. ⸜(｡˃ ᵕ ˂｡)⸝`);
        setSolutionSteps(result);
        setCurrentBoard([...data.grid]);

        // Highlight the first step automatically
        const step0 = result[0];
        const shape0 = data.shapes.find(s => s.id === step0.originalShapeId);
        if (shape0) {
          const initHighlights: number[] = [];
          for (const pt of shape0.points) {
            const ptX = pt % data.width;
            const ptY = Math.floor(pt / data.width);
            const idx = (step0.placementY + ptY) * data.width + (step0.placementX + ptX);
            if (idx >= 0 && idx < data.grid.length) initHighlights.push(idx);
          }
          setHighlights(initHighlights);
        }
      } else {
        setStatus("No solution found or operation cancelled. (´•︵•`)...");
      }
    } catch (e: any) {
      console.error(e);
      setStatus("Error: " + e.toString());
    } finally {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setIsSolving(false);
      setElapsedTime(performance.now() - startTimeRef.current);
    }
  }

  function toggleStep(checkedIndex: number) {
    if (!puzzleData || !solutionSteps.length) return;

    setActiveStepIndex(checkedIndex);

    const mt = maxToken;
    const nextBoard = [...puzzleData.grid];

    // Apply all steps up to checkedIndex
    for (let i = 0; i <= checkedIndex; i++) {
      const step = solutionSteps[i];
      if (!step) continue;
      applyStep(nextBoard, step, puzzleData.shapes, puzzleData.width, mt);
    }
    setCurrentBoard(nextBoard);

    // Highlight the NEXT step to take
    const nextStepIndex = checkedIndex + 1;
    if (nextStepIndex < solutionSteps.length) {
      const step = solutionSteps[nextStepIndex];
      const shape = puzzleData.shapes.find(s => s.id === step.originalShapeId);
      if (shape) {
        const newHighlights: number[] = [];
        const startX = step.placementX;
        const startY = step.placementY;

        for (const pt of shape.points) {
          const ptX = pt % puzzleData.width;
          const ptY = Math.floor(pt / puzzleData.width);
          const idx = (startY + ptY) * puzzleData.width + (startX + ptX);
          if (idx >= 0 && idx < nextBoard.length) newHighlights.push(idx);
        }
        setHighlights(newHighlights);
      }
    } else {
      setHighlights([]);
    }
  }

  function applyStep(board: number[], step: SolutionStep, shapes: any[], width: number, mt: number) {
    const shape = shapes.find(s => s.id === step.originalShapeId);
    if (!shape) return;

    const startX = step.placementX;
    const startY = step.placementY;

    for (const pt of shape.points) {
      const ptX = pt % width;
      const ptY = Math.floor(pt / width);
      const idx = (startY + ptY) * width + (startX + ptX);
      if (idx >= 0 && idx < board.length) {
        board[idx] = (board[idx] + 1) % mt;
      }
    }
  }

  const rows = puzzleData && cols > 0 ? puzzleData.grid.length / cols : 0;

  return (
    <div className="app-container">
      <div className="version-label">
        <a href="https://github.com/willnjohnson/Bakeru" target="_blank" rel="noopener noreferrer" className="github-link">
          <svg height="16" width="16" viewBox="0 0 16 16" fill="#ffffff" style={{ verticalAlign: 'middle', marginRight: '6px' }}>
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path>
          </svg>
        </a>
        Version 3.2.0
      </div>

      <header className="page-header">
        <h1 className="title">Bakeru 化ける</h1>
        <div className="subtitle-container">
          <p className="subtitle">. ݁₊ ⊹ . ݁ Shapeshifter Solver ݁ . ⊹ ₊ ݁.</p>
          <div className="subtitle-decoration">
            <span style={{ animationDelay: '0s' }}>✧</span>
            <span style={{ animationDelay: '.1s' }}>｡</span>
            <span style={{ animationDelay: '.2s' }}>⋆</span>
            <span style={{ animationDelay: '.3s' }}>.</span>
            <span style={{ animationDelay: '.4s' }}>-</span>
            <span style={{ animationDelay: '.5s' }}>*</span>
            <span style={{ animationDelay: '.6s' }}>⋆</span>
            <span style={{ animationDelay: '.7s' }}>⊹</span>
            <span style={{ animationDelay: '.8s' }}>˚</span>
            <span className="emote">٩(•̀ 𐃷&lt; )っ</span>
          </div>
        </div>
      </header>

      <main className="input-section">
        <div className="input-label-wrapper">
          <span className="input-label">Paste Shapeshifter HTML code:</span>
        </div>
        <textarea
          className="input-area"
          placeholder="Paste your source code here..."
          value={htmlInput}
          onChange={(e) => setHtmlInput(e.target.value)}
        />
        <div className="controls">
          <button
            className={`start-button ${isSolving ? 'stop' : ''}`}
            onClick={handleSolve}
          >
            {isSolving ? 'Stop' : 'Start'}
          </button>
          <div className="status">{status}</div>
        </div>
      </main>

      {isSolving && (
        <div className="solving-overlay">
          <div className="solving-card">
            <div className="solving-text">Time Elapsed</div>
            <div className="timer-display">{formatTime(elapsedTime)}</div>
          </div>
        </div>
      )}

      {currentBoard && !isSolving && (
        <div className="result-container">
          <div className="result-header">
            Result
          </div>
          <div className="result-content">
            <div className="steps-container">
              {solutionSteps.map((step, idx) => (
                <div key={idx} className={`step-item ${idx <= activeStepIndex ? 'checked' : ''}`}>
                  <label>
                    <input
                      type="checkbox"
                      checked={idx <= activeStepIndex}
                      onChange={() => toggleStep(idx <= activeStepIndex ? idx - 1 : idx)}
                    />
                    <span className="step-number">Step {(idx + 1).toString().padStart(2, '0')}:</span>
                    <span className="step-row-col">Row {step.placementY}, Col {step.placementX}</span>
                  </label>
                </div>
              ))}
            </div>
            <div className="grid-container">
              <div
                className="board-grid"
                style={{
                  gridTemplateColumns: `repeat(${cols}, 1fr)`,
                  gridTemplateRows: `repeat(${rows}, 1fr)`,
                  aspectRatio: `${cols} / ${rows}`,
                  // @ts-ignore
                  "--cols": cols,
                  // @ts-ignore
                  "--rows": rows,
                }}
              >
                {currentBoard.map((rawVal, idx) => {
                  const val = remapValue(rawVal, goal, maxToken);
                  const isHighlighted = highlights.includes(idx);
                  const bg = isHighlighted ? "#ffffff" : (val < VALUE_COLORS.length ? VALUE_COLORS[val] : COLOR_GRAY);
                  const fg = isHighlighted ? "#2c1810" : "white";
                  const w = isHighlighted ? "bold" : "normal";

                  return (
                    <div
                      key={idx}
                      className="board-cell"
                      style={{
                        backgroundColor: bg,
                        color: fg,
                        fontWeight: w
                      }}
                    >
                      {val}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;

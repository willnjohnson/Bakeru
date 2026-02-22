const extractShapeId = (src: string) =>
    src.slice(src.lastIndexOf("/") + 1, src.lastIndexOf("_")) || "unknown";

export interface PuzzleData {
    width: number;
    height: number;
    grid: number[];
    goal: number;
    shapes: { id: number; points: number[] }[];
}

export function parseHTML(html: string): PuzzleData {
    const doc = new DOMParser().parseFromString(html, "text/html");

    // --- Dimensions ---
    const scriptText = [...doc.scripts].map(s => s.textContent ?? "").join("\n");
    const gX = +(scriptText.match(/gX\s*=\s*(\d+)/)?.[1] ?? 0);
    const gY = +(scriptText.match(/gY\s*=\s*(\d+)/)?.[1] ?? 0);
    if (!gX || !gY) throw new Error("Board dimensions not found.");

    // --- Goal + Cycle ---
    const goalSmall = [...doc.querySelectorAll("small")]
        .find(s => s.textContent?.includes("GOAL"));
    const goalTd = goalSmall?.closest("td");
    const goalRow = goalTd?.parentElement;
    if (!goalTd || !goalRow) throw new Error("GOAL section not found.");

    const cycle = [...goalRow.querySelectorAll("img")]
        .map(img => img.getAttribute("src") ?? "")
        .filter(src => !src.includes("arrow.gif"))
        .map(extractShapeId)
        .filter((v, i, a) => v && a.indexOf(v) === i);

    if (!cycle.length) throw new Error("Cycle not found.");

    const map = new Map(cycle.map((v, i) => [v, i]));
    const goalImg = [...goalTd.querySelectorAll("img")]
        .find(img => !img.src.includes("arrow.gif"));
    if (!goalImg) throw new Error("Goal image missing.");

    const goalIndex = map.get(extractShapeId(goalImg.src));
    if (goalIndex === undefined) throw new Error("Goal not in cycle.");

    // --- Board ---
    const board = [...doc.querySelectorAll("table[align='center'][cellpadding='0']")]
        .find(t => (t as HTMLTableElement).rows.length === gY) as HTMLTableElement;
    if (!board) throw new Error("Board not found.");

    const grid = [...board.rows]
        .flatMap(row =>
            [...row.querySelectorAll("img")]
                .map(img => map.get(extractShapeId(img.src)) ?? 0)
        );

    // --- Shape Parsing ---
    const shapes: { id: number; points: number[] }[] = [];

    const parseShapeTable = (table: HTMLTableElement) => {
        const pts = [...table.rows].flatMap((row, y) =>
            [...row.cells]
                .map((cell, x) =>
                    cell.querySelector("img[src*='square.gif']") ? { x, y } : null
                )
                .filter(Boolean) as { x: number; y: number }[]
        );
        if (!pts.length) return;

        const minX = Math.min(...pts.map(p => p.x));
        const minY = Math.min(...pts.map(p => p.y));

        shapes.push({
            id: shapes.length,
            points: pts.map(p => (p.y - minY) * gX + (p.x - minX))
        });
    };

    const parseSection = (label: string) => {
        const result = doc.evaluate(
            `//big[contains(normalize-space(.),'${label}')]/parent::*` +
            `/following-sibling::table[1]` +
            `/descendant-or-self::table[@cellpadding='0']`,
            doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null
        );
        for (let i = 0; i < result.snapshotLength; i++)
            parseShapeTable(result.snapshotItem(i) as HTMLTableElement);
    };

    parseSection("ACTIVE SHAPE");
    parseSection("NEXT SHAPE");

    return { width: gX, height: gY, grid, goal: goalIndex, shapes };
}
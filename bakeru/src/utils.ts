
// Helper function to extract shape ID from image URL
function extractShapeId(src: string): string {
    const lastSlash = src.lastIndexOf('/');
    const underscore = src.lastIndexOf('_');
    if (lastSlash !== -1 && underscore !== -1 && underscore > lastSlash) {
        return src.substring(lastSlash + 1, underscore);
    }
    return "unknown";
}

export interface PuzzleData {
    width: number;
    height: number;
    grid: number[];
    goal: number;
    shapes: Array<{ id: number, points: number[] }>;
}

export function parseHTML(html: string): PuzzleData {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    // 1. Extract board dimensions from JavaScript
    let gX = 0, gY = 0;
    const scripts = Array.from(doc.getElementsByTagName('script'));
    for (const script of scripts) {
        const text = script.textContent || "";
        const matchGX = text.match(/gX\s*=\s*(\d+);/);
        const matchGY = text.match(/gY\s*=\s*(\d+);/);
        if (matchGX) gX = parseInt(matchGX[1]);
        if (matchGY) gY = parseInt(matchGY[1]);
        if (gX && gY) break;
    }

    if (!gX || !gY) {
        throw new Error("Could not parse board dimensions from script.");
    }

    // 2. Find GOAL cycle table and extract cycle order
    // "small[contains(text(),'GOAL')]" logic
    // In DOM: find all <small>, check text content
    const smalls = Array.from(doc.getElementsByTagName('small'));
    const goalSmall = smalls.find(el => el.textContent?.includes('GOAL'));
    const goalTd = goalSmall?.closest('td');
    const goalCycleRow = goalTd?.parentElement;

    if (!goalCycleRow) {
        throw new Error("Cannot find GOAL cycle information.");
    }

    // Extract cycle order from goal row images
    const cycleOrder: string[] = [];
    const imgsInCycle = Array.from(goalCycleRow.getElementsByTagName('img'));
    for (const img of imgsInCycle) {
        const src = img.getAttribute('src') || "";
        if (!src.includes('arrow.gif')) {
            const id = extractShapeId(src);
            if (id && !cycleOrder.includes(id)) {
                cycleOrder.push(id);
            }
        }
    }

    const mappings = new Map<string, number>();
    cycleOrder.forEach((shape, i) => mappings.set(shape, i));

    if (cycleOrder.length === 0) {
        throw new Error("Could not determine puzzle rank.");
    }

    // 3. Extract goal shape
    // "goalTd.SelectSingleNode..."
    // In DOM: goalTd -> find img (not arrow)
    const goalImgs = Array.from(goalTd?.getElementsByTagName('img') || []);
    const goalImg = goalImgs.find(img => !img.getAttribute('src')?.includes('arrow.gif'));

    if (!goalImg) {
        throw new Error("Cannot find goal image.");
    }

    const goalShapeId = extractShapeId(goalImg.getAttribute('src') || "");
    if (!mappings.has(goalShapeId)) {
        throw new Error(`Goal shape '${goalShapeId}' not in cycle order.`);
    }

    const goalIndex = mappings.get(goalShapeId)!;

    // 4. Extract board state
    // "table[@align='center' and @cellpadding='0']"
    // This is tricky. Let's find table with correct number of rows?
    // Or just look for the main board table.
    // In Neopets, it's usually the one with the grid images.
    const tables = Array.from(doc.getElementsByTagName('table'));
    let boardTable: HTMLTableElement | null = null;

    for (const table of tables) {
        if (table.align === 'center' && table.getAttribute('cellpadding') === '0') {
            // Check if it looks like the board (gY rows)
            // But note: DOM rows include all <tr>.
            if (table.rows.length === gY) {
                boardTable = table;
                break;
            }
        }
    }

    if (!boardTable) {
        // Fallback: search for any table with gY rows and gX images per row?
        for (const table of tables) {
            if (table.rows.length === gY) {
                const firstRow = table.rows[0];
                const imgs = firstRow.getElementsByTagName('img');
                if (imgs.length === gX) {
                    boardTable = table;
                    break;
                }
            }
        }
    }

    if (!boardTable) {
        throw new Error(`Expected ${gY} rows in board but found none matching.`);
    }

    const grid: number[] = [];
    for (let r = 0; r < gY; r++) {
        const row = boardTable.rows[r];
        const imgs = row.getElementsByTagName('img');
        if (imgs.length !== gX) {
            throw new Error(`Expected ${gX} columns in row ${r} but found ${imgs.length}.`);
        }
        for (let c = 0; c < gX; c++) {
            const shapeId = extractShapeId(imgs[c].getAttribute('src') || "");
            grid.push(mappings.get(shapeId) ?? 0);
        }
    }

    // 5. Parse Shapes
    const shapes: Array<{ id: number, points: number[] }> = [];

    // Helper to extract points from a table
    const parseShapeTable = (table: HTMLTableElement): number[] | null => {
        const points: Array<{ x: number, y: number }> = [];
        const rows = table.rows;
        for (let r = 0; r < rows.length; r++) {
            const cells = rows[r].cells;
            for (let c = 0; c < cells.length; c++) {
                const img = cells[c].querySelector("img[src*='square.gif']");
                if (img) {
                    points.push({ x: c, y: r });
                }
            }
        }

        if (points.length === 0) return null;

        // Normalize
        const minX = Math.min(...points.map(p => p.x));
        const minY = Math.min(...points.map(p => p.y));

        // Convert to flat indices on the main board?
        // Wait, C# code:
        // "Normalize to bounding box" -> YES.
        // "var flatIndices = points.Select(p => (p.y - minY) * gX + (p.x - minX))" [Wait, *gX*?]
        // The C# code uses `gX` (board width) for shape point flattening?
        // YES. "Normalize to bounding box... (p.y - minY) * gX + (p.x - minX)"
        // This means the shape points are represented as offsets in the MAIN GRID coordinate system.
        // This matches `solver.rs` expectation where `pt % width` and `pt / width` are used.
        // So `solver.rs` expects `y * board_width + x`.

        return points.map(p => (p.y - minY) * gX + (p.x - minX));
    };

    // ACTIVE SHAPE
    // Find 'ACTIVE SHAPE' text (in <big> tag usually)
    // "activeHeader?.ParentNode.SelectNodes..."
    // In DOM: find explicit text
    const bigs = Array.from(doc.getElementsByTagName('big'));
    const activeHeader = bigs.find(el => el.textContent?.includes('ACTIVE SHAPE'));

    if (activeHeader) {
        // Find the active shape using XPath, which is more robust than manual DOM walking.
        const xpathResult = doc.evaluate(
            "//big[contains(text(),'ACTIVE SHAPE')]/parent::*/following-sibling::table[@cellpadding='15']//table[@cellpadding='0']",
            doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null
        );
        for (let i = 0; i < xpathResult.snapshotLength; i++) {
            const t = xpathResult.snapshotItem(i) as HTMLTableElement;
            const pts = parseShapeTable(t);
            if (pts) shapes.push({ id: shapes.length, points: pts });
        }
    }

    // NEXT SHAPES
    const nextHeader = bigs.find(el => el.textContent?.includes('NEXT SHAPES'));
    if (nextHeader) {
        const xpathResult = doc.evaluate(
            "//big[contains(text(),'NEXT SHAPES')]/parent::*/following-sibling::table[@cellpadding='15']//td//table[@cellpadding='0']",
            doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null
        );
        for (let i = 0; i < xpathResult.snapshotLength; i++) {
            const t = xpathResult.snapshotItem(i) as HTMLTableElement;
            const pts = parseShapeTable(t);
            if (pts) shapes.push({ id: shapes.length, points: pts });
        }
    }

    return {
        width: gX,
        height: gY,
        grid,
        goal: goalIndex,
        shapes
    };
}

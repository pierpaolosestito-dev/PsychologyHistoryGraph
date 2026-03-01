//datasets.ts
import protagonistiLuoghi from "./relazioni.json";
import protagonisti from "./protagonisti_relazioni.json";
import luoghi from "./protagonisti_luoghi_relazioni.json";

export type DatasetMode = "all" | "personaggi" | "luoghi";

export const DATASETS: Record<DatasetMode, Record<string, string[]>> = {
  all: protagonistiLuoghi,
  personaggi: protagonisti,
  luoghi: luoghi
};

// =====================================================
// ASP-friendly mapping (lazy + cached)
// =====================================================

export type AspNodeType = "person" | "place";

export interface AspGraph {
  index: Record<number, { type: AspNodeType; name: string }>;
  idByKey: Record<string, number>;
  edges: Array<[number, number]>;
}

const ASP_CACHE: Partial<Record<DatasetMode, AspGraph>> = {};
const ASP_DEBUG = true;

export function getAspGraph(mode: DatasetMode): AspGraph {
  const cached = ASP_CACHE[mode];
  if (cached) return cached;

  const dataset = DATASETS[mode];

  // -------------------------------------------------
  // 1) Costruisco insieme di tutte le persone
  // -------------------------------------------------

  const peopleSet = new Set<string>();

  for (const m of Object.keys(DATASETS) as DatasetMode[]) {
    const d = DATASETS[m];
    for (const personName of Object.keys(d)) {
      peopleSet.add(personName);
    }
  }

  // -------------------------------------------------
  // 2) Raccolgo tutte le entità (type:name)
  // -------------------------------------------------

  type EntityKey = string;
  const entityKeysSet = new Set<EntityKey>();

  for (const personName of Object.keys(dataset)) {
    entityKeysSet.add(`person:${personName}`);

    const targets = dataset[personName] ?? [];
    for (const t of targets) {
      const tType: AspNodeType = peopleSet.has(t) ? "person" : "place";
      entityKeysSet.add(`${tType}:${t}`);
    }
  }

  // -------------------------------------------------
  // 3) ID stabili (ordinamento lessicografico)
  // -------------------------------------------------

  const entityKeys = Array.from(entityKeysSet).sort((a, b) =>
    a.localeCompare(b)
  );

  const idByKey: Record<string, number> = {};
  const index: Record<number, { type: AspNodeType; name: string }> = {};

  let nextId = 1;

  for (const k of entityKeys) {
    idByKey[k] = nextId;

    const sep = k.indexOf(":");
    const type = k.slice(0, sep) as AspNodeType;
    const name = k.slice(sep + 1);

    index[nextId] = { type, name };
    nextId++;
  }

  // -------------------------------------------------
  // 4) Costruzione edges (deduplicati)
  // -------------------------------------------------

  const edgeSet = new Set<string>();
  const edges: Array<[number, number]> = [];

  for (const personName of Object.keys(dataset)) {
    const fromId = idByKey[`person:${personName}`];
    const targets = dataset[personName] ?? [];

    for (const t of targets) {
      const tType: AspNodeType = peopleSet.has(t) ? "person" : "place";
      const toId = idByKey[`${tType}:${t}`];

      if (!fromId || !toId) continue;

      const [a, b] = fromId < toId ? [fromId, toId] : [toId, fromId];
      const key = `${a}->${b}`;

      if (edgeSet.has(key)) continue;

      edgeSet.add(key);
      edges.push([a, b]);
    }
  }

  const graph: AspGraph = {
    index,
    idByKey,
    edges
  };

  // -------------------------------------------------
  // DEBUG
  // -------------------------------------------------

  if (ASP_DEBUG) {
    console.group(`[ASP DEBUG] Mode: ${mode}`);
    console.log("Tot nodes:", Object.keys(index).length);
    console.log("Tot edges:", edges.length);

    console.log("First 10 nodes:");
    Object.entries(index)
      .slice(0, 10)
      .forEach(([id, v]) => {
        console.log(`  ${id} -> (${v.type}) ${v.name}`);
      });

    console.log("First 10 edges:");
    edges.slice(0, 10).forEach(([a, b]) => {
      console.log(`  edge(${a}, ${b})`);
    });

    console.groupEnd();
  }

  ASP_CACHE[mode] = graph;
  return graph;
}

// -------------------------------------------------
// SOLO facts necessari per Maximum Clique
// -------------------------------------------------

export function getAspFactsLp(mode: DatasetMode): string {
  const g = getAspGraph(mode);

  const lines: string[] = [];

  // nodes
  for (const id of Object.keys(g.index).map(Number)) {
    lines.push(`node(${id}).`);
  }

  // edges
  for (const [a, b] of g.edges) {
    lines.push(`edge(${a},${b}).`);
  }

  const content = lines.join("\n");

  if (ASP_DEBUG) {
    console.group(`[ASP DEBUG] LP preview (${mode})`);
    content
      .split("\n")
      .slice(0, 30)
      .forEach(line => console.log(line));
    console.groupEnd();
  }

  return content;
}

// -------------------------------------------------
// Debug manuale da console browser
// -------------------------------------------------

declare global {
  interface Window {
    dumpAsp?: (mode?: DatasetMode) => void;
  }
}

if (typeof window !== "undefined") {
  window.dumpAsp = (mode?: DatasetMode) => {
    const currentMode =
      mode ??
      ((window as any).getCurrentDatasetMode?.() as DatasetMode) ??
      "all";

    console.log(getAspFactsLp(currentMode));
  };
}

// =====================================================
// EXPORT LP FILE FOR DEBUG
// =====================================================

export function downloadAspLp(mode: DatasetMode): void {
  const facts = getAspFactsLp(mode);

  const ASP_PROGRAM = `
{in(V)} :- node(V).
:- in(U), in(V), U < V, not edge(U,V), not edge(V,U).
:~ node(V), not in(V). [1@1, V].
#show in/1.
`;

  const fullProgram =
    facts.trim() + "\n\n" + ASP_PROGRAM.trim() + "\n";

  const blob = new Blob([fullProgram], { type: "text/plain" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `debug_${mode}.lp`;
  document.body.appendChild(a);
  a.click();

  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  console.log(`✅ LP file generated for mode: ${mode}`);
}

declare global {
  interface Window {
    dumpAspFile?: (mode?: DatasetMode) => void;
  }
}

if (typeof window !== "undefined") {
  window.dumpAspFile = (mode?: DatasetMode) => {
    const m = mode ?? "all";
    downloadAspLp(m);
  };
}
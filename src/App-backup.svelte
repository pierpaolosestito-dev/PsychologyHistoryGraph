<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import ForceGraph3D from "3d-force-graph";
  import Graph from "graphology";
  import * as THREE from "three";
  import { forceManyBody, forceCenter, forceLink } from "d3-force-3d";
  import TimelineSlider from "./components/TimelineSlider.svelte";
  import {
  loadDetails,
  personDetailsMap,
  placeDetailsMap,
  type NodeDetails
} from "./data/details";
  import {
  DATASETS,
  type DatasetMode,
  getAspFactsLp,
  getAspGraph
} from "./data/datasets";
  import InfoPanel from "./components/InfoPanel.svelte";
  import HistoryPanel from "./components/HistoryPanel.svelte";
  import SolverPanel from "./components/SolverPanel.svelte";
  
  let container: HTMLDivElement;
  let graph3D: any;
  

  // ---------------- STATE ----------------
  let data: any = null;
  let originalData: any = null;
  let query = "";
  let currentStart = 1776;
  let currentEnd = 2017;
  let timelineTimeout: any = null;

  let rootSelectedId: string | null = null;
  let selectedId: string | null = null;
  let selectedNode: any = null;

  function updateSelectedDetails(id: string) {
  if (personDetailsMap.has(id)) {
    selectedDetails = personDetailsMap.get(id)!;
  } else if (placeDetailsMap.has(id)) {
    selectedDetails = placeDetailsMap.get(id)!;
  } else {
    selectedDetails = null;
  }
}

  let selectedDetails: NodeDetails | null = null;
  let neighborMap: Map<string, Set<string>> = new Map();
  let highlightedNeighbors = new Set<string>();
  let cliqueNodes = new Set<string>();
  // ---------------- SOLVER STATE ----------------
let showSolverPanel = false;

let maximumCliques: string[][] = [];
let allCliques: string[][] = [];

let solverStats = {
  totalCliques: 0,
  maxSize: 0,
  histogram: new Map<number, number>(),
  timeMs: undefined as number | undefined,
  nodesCount: undefined as number | undefined,
  linksCount: undefined as number | undefined,
  datasetMode: undefined as string | undefined,
  periodLabel: undefined as string | undefined
};

let minCliqueSize = 3;
let topPerSize = 5;
// ---------------- MACRO FILTER (OPTIONAL) ----------------
let selectedMacroArea: string = "";
let availableMacroAreas: string[] = [];

    let datasetMode: DatasetMode = "all";


    function atomize(s: string) {
  return s
    .toLowerCase()
    .replace(/&/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
  function normalizeName(s: string) {
  return (s ?? "")
    .trim()
    .replace(/\s+/g, " ");
}
  // ---------------- HISTORY ----------------
  let history: string[] = [];

  function startHistory(id: string) {
    history = [id];
  }

  function pushHistory(id: string) {
    if (history[history.length - 1] === id) return;
    history = [...history, id];
  }

  function truncateHistoryTo(id: string) {
    const idx = history.lastIndexOf(id);
    if (idx >= 0) history = history.slice(0, idx + 1);
  }

  function clearHistory() {
    history = [];
  }

  // ---------------- AUTOCOMPLETE ----------------
  let searchIndex: { label: string; norm: string }[] = [];
  let suggestions: string[] = [];
  let showSuggestions = false;

  function buildSearchIndex(json: Record<string, string[]>) {
    const set = new Set<string>();
    for (const [src, targets] of Object.entries(json)) {
      set.add(src);
      targets.forEach((t) => set.add(t));
    }
    searchIndex = Array.from(set).map((label) => ({
      label,
      norm: label.toLowerCase(),
    }));
    suggestions = [];
    showSuggestions = false;
  }

  function rankCandidates(q: string) {
    const text = q.trim().toLowerCase();
    if (text.length < 2) {
      suggestions = [];
      showSuggestions = false;
      return;
    }

    const ranked = searchIndex
      .map((item) => {
        let score = 0;
        if (item.norm.startsWith(text)) score += 3;
        else if (item.norm.includes(` ${text}`)) score += 2;
        else if (item.norm.includes(text)) score += 1;
        return { label: item.label, score };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score || a.label.length - b.label.length)
      .slice(0, 7)
      .map((r) => r.label);

    suggestions = ranked;
    showSuggestions = ranked.length > 0;
  }

  function chooseSuggestion(label: string) {
    query = label;
    showSuggestions = false;
    searchNode(label);
  }

  // ---------------- COLOR UTILS ----------------
  function colorFromString(str: string) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return `hsl(${Math.abs(hash) % 360}, 70%, 55%)`;
  }

  const colorAccessor = (n: any) => {
    if (cliqueNodes.has(n.id)) return "#7dd3fc";
    if (!selectedId) return colorFromString(n.id);
    if (n.id === selectedId) return "#facc15";
    if (highlightedNeighbors.has(n.id)) return "#7dd3fc";
    if (neighborMap.get(selectedId)?.has(n.id)) return "#60a5fa";
    return "#334155";
  };

  function opacityForNode(nodeId: string) {
    if (cliqueNodes.has(nodeId)) return 1;
    if (!selectedId) return 1;
    if (nodeId === selectedId) return 1;
    if (highlightedNeighbors.has(nodeId)) return 1;
    if (neighborMap.get(selectedId)?.has(nodeId)) return 0.95;
    return 0.22;
  }

  // ---------------- ICON + RING ----------------
  const textureLoader = new THREE.TextureLoader();
  const iconTexture = textureLoader.load("icon.png");
  iconTexture.colorSpace = THREE.SRGBColorSpace;
  const ringGeometry = new THREE.RingGeometry(0.65, 0.85, 32);

  function makeIconSprite(size = 14, opacity = 1) {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: iconTexture,
        transparent: true,
        depthWrite: false,
        opacity,
      })
    );
    sprite.scale.set(size, size, 1);
    return sprite;
  }

  function makeRing(color: string, opacity = 1) {
    const ring = new THREE.Mesh(
      ringGeometry,
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: Math.min(0.95, opacity),
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    ring.rotation.x = Math.PI / 2;
    ring.scale.set(8, 8, 8);
    return ring;
  }

  function makeLabel(text: string, opacity = 1) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    ctx.font = "26px sans-serif";
    canvas.width = ctx.measureText(text).width + 20;
    canvas.height = 36;
    ctx.font = "26px sans-serif";
    ctx.fillStyle = "white";
    ctx.fillText(text, 10, 26);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;

    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        opacity,
      })
    );
    sprite.scale.set(18, 8, 1);
    return sprite;
  }

  function makeNodeObject(node: any) {
    const group = new THREE.Group();
    const o = opacityForNode(node.id);
    group.add(makeIconSprite(14, o));
    group.add(makeRing(colorAccessor(node), o));
    const label = makeLabel(node.label, Math.max(0.18, o));
    label.position.y = -10;
    group.add(label);
    return group;
  }

  function refreshNodeVisuals() {
    graph3D.nodeThreeObject((node: any) => makeNodeObject(node));
  }

  // ---------------- GRAPH BUILD ----------------
  function buildGraphFromJson(json: Record<string, string[]>) {
  const graph = new Graph({ type: "undirected" });
  const edgeSet = new Set<string>();

  function normalizeName(s: string) {
    return (s ?? "")
      .trim()
      .replace(/\s+/g, " ");
  }

  Object.entries(json).forEach(([src, targets]) => {
    const srcN = normalizeName(src);

    if (!graph.hasNode(srcN)) {
      graph.addNode(srcN, { label: srcN });
    }

    targets.forEach((dst) => {
      const dstN = normalizeName(dst);

      if (!graph.hasNode(dstN)) {
        graph.addNode(dstN, { label: dstN });
      }

      const key = [srcN, dstN].sort().join("||");

      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        graph.addEdge(srcN, dstN);
      }
    });
  });

  const nodes: any[] = [];
  const links: any[] = [];

  graph.forEachNode((id, attrs) => {
    nodes.push({ id, label: attrs.label });
  });

  graph.forEachEdge((_, __, s, t) => {
    links.push({ source: s, target: t });
  });

  return { nodes, links };
}

  function buildNeighborMap() {
    neighborMap = new Map();
    data.links.forEach((l: any) => {
      const s = l.source as string;
      const t = l.target as string;
      if (!neighborMap.has(s)) neighborMap.set(s, new Set());
      if (!neighborMap.has(t)) neighborMap.set(t, new Set());
      neighborMap.get(s)!.add(t);
      neighborMap.get(t)!.add(s);
    });
  }

  // ---------------- DATASET SWITCH ----------------
  function loadDataset(mode: DatasetMode) {
    currentStart = 1776;
    currentEnd = 2017;
    datasetMode = mode;
    rootSelectedId = null;
    selectedId = null;
    selectedNode = null;
    highlightedNeighbors = new Set();
    cliqueNodes = new Set();
    clearHistory();

    originalData = buildGraphFromJson(DATASETS[mode]);
data = originalData;
    buildNeighborMap();
    buildSearchIndex(DATASETS[mode]);

    graph3D.graphData(data);
    refreshNodeVisuals();
    graph3D.cameraPosition({ x: 0, y: 0, z: 220 }, { x: 0, y: 0, z: 0 }, 800);
  }

 function applyTimelineFilter() {
  console.log("[TL] applyTimelineFilter", {
    currentStart,
    currentEnd,
    nodes: originalData?.nodes?.length
  });

  if (!originalData) return;

  // --- 1) Persone visibili (vive nel periodo) ---
  const visiblePersons = new Set<string>();

  for (const node of originalData.nodes) {
    const details = personDetailsMap.get(node.id);
    if (!details) continue;

    const birth = details.anno_nascita ?? 0;
    const death = details.anno_morte ?? 9999;

    if (birth <= currentEnd && death >= currentStart) {
      visiblePersons.add(node.id);
    }
  }

  // --- 2) Luoghi visibili: SOLO quelli collegati direttamente a persone visibili ---
  const visiblePlaces = new Set<string>();

  for (const link of originalData.links) {
    const sourceId =
      typeof link.source === "object" && link.source !== null
        ? (link.source as any).id
        : (link.source as string);

    const targetId =
      typeof link.target === "object" && link.target !== null
        ? (link.target as any).id
        : (link.target as string);

    // Se la sorgente è una persona visibile, il target (se non è persona) lo consideriamo luogo
    if (visiblePersons.has(sourceId) && !personDetailsMap.has(targetId)) {
      visiblePlaces.add(targetId);
    }

    // Viceversa: se il target è persona visibile, il source (se non è persona) è luogo
    if (visiblePersons.has(targetId) && !personDetailsMap.has(sourceId)) {
      visiblePlaces.add(sourceId);
    }
  }

  // --- 3) Nodo visibile = persona visibile OR luogo visibile ---
  const visibleNodes = new Set<string>([...visiblePersons, ...visiblePlaces]);

  // --- 4) Filtra nodi ---
  const filteredNodes = originalData.nodes.filter((n: any) => visibleNodes.has(n.id));

  // --- 5) Filtra archi: entrambi gli estremi devono essere visibili ---
  // + (opzionale ma consigliato) tieni SOLO archi persona-luogo per essere "rigoroso"
  const filteredLinks = originalData.links.filter((l: any) => {
    const sourceId =
      typeof l.source === "object" && l.source !== null ? l.source.id : l.source;
    const targetId =
      typeof l.target === "object" && l.target !== null ? l.target.id : l.target;

    if (!visibleNodes.has(sourceId) || !visibleNodes.has(targetId)) return false;

    const sourceIsPerson = personDetailsMap.has(sourceId);
    const targetIsPerson = personDetailsMap.has(targetId);

    // Rigoroso: tieni solo link persona <-> luogo
    return visibleNodes.has(sourceId) && visibleNodes.has(targetId);
  });

  data = {
    nodes: filteredNodes,
    links: filteredLinks
  };

  graph3D.graphData(data);

  // Ricostruisci neighborMap coerente con i nuovi link
  neighborMap = new Map();
  data.links.forEach((l: any) => {
    const s =
      typeof l.source === "object" && l.source !== null ? l.source.id : l.source;
    const t =
      typeof l.target === "object" && l.target !== null ? l.target.id : l.target;

    if (!neighborMap.has(s)) neighborMap.set(s, new Set());
    if (!neighborMap.has(t)) neighborMap.set(t, new Set());
    neighborMap.get(s)!.add(t);
    neighborMap.get(t)!.add(s);
  });

  console.log("[TL] visiblePersons:", visiblePersons.size);
  console.log("[TL] visiblePlaces:", visiblePlaces.size);
  console.log("[TL] filteredNodes:", filteredNodes.length);
  console.log("[TL] filteredLinks:", filteredLinks.length);
}
  // ---------------- INTERACTIONS ----------------
  function focusNode(id: string) {
    const node = data.nodes.find((n: any) => n.id === id);
    if (!node || node.x == null) return;
    graph3D.cameraPosition(
      { x: node.x * 2, y: node.y * 2, z: node.z * 2 + 40 },
      { x: node.x, y: node.y, z: node.z },
      900
    );
  }

  function selectNode(id: string) {
  const node = data.nodes.find((n: any) => n.id === id);
  const degree = data.links.filter(
    (l: any) => l.source === id || l.target === id
  ).length;

  selectedNode = { ...node, degree };

  updateSelectedDetails(id); 
}

  function viewNeighbor(id: string) {
    highlightedNeighbors = new Set([id]);
    focusNode(id);
    selectNode(id);
    refreshNodeVisuals();
  }

  function commitNeighbor(id: string) {
    rootSelectedId = id;
    selectedId = id;
    highlightedNeighbors = new Set();
    pushHistory(id);
    focusNode(id);
    selectNode(id);
    refreshNodeVisuals();
  }

  function backToRoot() {
    if (!rootSelectedId) return;
    highlightedNeighbors = new Set();
    focusNode(rootSelectedId);
    selectNode(rootSelectedId);
    refreshNodeVisuals();
  }

  function searchNode(q: string) {
    const text = q.trim().toLowerCase();
    if (!text) return;
    const node = data.nodes.find((n: any) => n.label.toLowerCase().includes(text));
    if (!node) return;

    rootSelectedId = node.id;
    selectedId = node.id;
    highlightedNeighbors = new Set();
    startHistory(node.id);
    focusNode(node.id);
    selectNode(node.id);
    refreshNodeVisuals();
  }

  function resetView() {
    rootSelectedId = null;
    selectedId = null;
    selectedNode = null;
    highlightedNeighbors = new Set();
    cliqueNodes = new Set();
    suggestions = [];
    showSuggestions = false;
    clearHistory();
    refreshNodeVisuals();
    graph3D.cameraPosition({ x: 0, y: 0, z: 220 }, { x: 0, y: 0, z: 0 }, 800);
  }

  function clearClique() {
  cliqueNodes = new Set();
  refreshNodeVisuals();
}

  function zoomIn() {
    const cam = graph3D.camera();
    graph3D.cameraPosition(
      { x: cam.position.x, y: cam.position.y, z: cam.position.length() * 0.75 },
      undefined,
      300
    );
  }

  function zoomOut() {
    const cam = graph3D.camera();
    graph3D.cameraPosition(
      { x: cam.position.x, y: cam.position.y, z: cam.position.length() * 1.3 },
      undefined,
      300
    );
  }

  const ASP_PROGRAM_DEFAULT = `
{ in(V) : node(V) }.

:- in(U), in(V), U < V, not edge(U,V).

#maximize { 1,V : in(V) }.

#show in/1.
`;

const ASP_PROGRAM_FILTERED = (macroAtom: string) => `
valid(V) :- node(V), macro(V, ${macroAtom}).

{ in(V) : valid(V) }.

:- in(U), in(V), U < V, not edge(U,V).

#maximize { 1,V : in(V) }.

#show in/1.
`;

function buildAspFactsFromCurrentData() {
  if (!data) return { facts: "", reverseIndex: {} };

  const indexMap = new Map<string, number>();
  const reverseIndex: Record<number, string> = {};

  let counter = 1;

  // assegna ID numerici ai nodi visibili
  for (const node of data.nodes) {
    indexMap.set(node.id, counter);
    reverseIndex[counter] = node.id;
    counter++;
  }

  let facts = "";

  // node facts
  for (const [_, idx] of indexMap) {
    facts += `node(${idx}).\n`;
  }

  // macro facts (solo persone)
  for (const node of data.nodes) {
    const details = personDetailsMap.get(node.id);
    if (!details?.roles) continue;

    const idx = indexMap.get(node.id);
    if (!idx) continue;

    for (const role of details.roles) {
      if (role.macro_area) {
        const atom = atomize(role.macro_area);
        facts += `macro(${idx},${atom}).\n`;
      }
    }
  }

  // edge facts
  for (const link of data.links) {
    const sourceId =
      typeof link.source === "object" ? link.source.id : link.source;

    const targetId =
      typeof link.target === "object" ? link.target.id : link.target;

    const s = indexMap.get(sourceId);
    const t = indexMap.get(targetId);

    if (s && t) {
      facts += `edge(${s},${t}).\n`;
      facts += `edge(${t},${s}).\n`;
    }
  }

  return { facts, reverseIndex };
}
async function runMaximumClique() {
  console.log("🔵 [CLIQUE] Starting computation on FILTERED graph...");
  console.time("CLIQUE_TIME");

  if (!data || !data.nodes?.length) {
    console.warn("⚠️ No visible nodes. Aborting clique computation.");
    return;
  }

  // 🔹 Costruisci fatti ASP dal grafo ATTUALMENTE visibile
  const { facts, reverseIndex } = buildAspFactsFromCurrentData();

  if (!facts.trim()) {
    console.warn("⚠️ No facts generated. Aborting.");
    return;
  }

  let program: string;

if (!selectedMacroArea) {
  program = ASP_PROGRAM_DEFAULT;
} else {
  const atom = atomize(selectedMacroArea);
  program = ASP_PROGRAM_FILTERED(atom);
}

const fullProgram =
  facts.trim() + "\n\n" + program.trim() + "\n";

  const t0 = performance.now();

  return new Promise<void>((resolve) => {

    const handler = (e: MessageEvent) => {
      const msg = e.data;

      if (msg?.Result === "ERROR") {
        console.error("❌ CLINGO ERROR:", msg.Error);
        console.timeEnd("CLIQUE_TIME");
        clingoWorker.removeEventListener("message", handler);
        resolve();
        return;
      }

      if (!msg?.Call?.[0]?.Witnesses) return;

      const t1 = performance.now();

      const witnesses = msg.Call[0].Witnesses;

      const foundCliques: string[][] = [];

      for (const w of witnesses) {
        const ids = w.Value
          .filter((v: string) => v.startsWith("in("))
          .map((atom: string) => {
            const m = atom.match(/in\((\d+)\)/);
            return m ? parseInt(m[1]) : null;
          })
          .filter(Boolean) as number[];

        const names = ids
          .map((id) => reverseIndex[id])
          .filter(Boolean);

        if (names.length > 2) {
          foundCliques.push(names);
        }
      }

      if (!foundCliques.length) {
        console.warn("⚠️ No clique > size 2 found in filtered graph");
        console.timeEnd("CLIQUE_TIME");
        clingoWorker.removeEventListener("message", handler);
        resolve();
        return;
      }

      // 🔹 Ordina per dimensione decrescente
      foundCliques.sort((a, b) => b.length - a.length);

      const maxSize = foundCliques[0].length;

      const maxCliques = foundCliques.filter(c => c.length === maxSize);

      console.log("🟢 Maximum Clique(s) on FILTERED graph: size =", maxSize);
      maxCliques.forEach((c, i) =>
        console.log(`  Max ${i + 1}:`, c)
      );

      console.log("⚪ Other Cliques (size > 1):");
      foundCliques
        .filter(c => c.length < maxSize)
        .forEach((c, i) =>
          console.log(`  Clique ${i + 1} (size=${c.length}):`, c)
        );

      // 🔹 Costruisci istogramma
      const hist = new Map<number, number>();
      for (const c of foundCliques) {
        hist.set(c.length, (hist.get(c.length) ?? 0) + 1);
      }

      // 🔹 Salva stato globale
      maximumCliques = maxCliques;
      allCliques = foundCliques;

      solverStats = {
        totalCliques: foundCliques.length,
        maxSize,
        histogram: hist,
        timeMs: t1 - t0,
        nodesCount: data.nodes.length,
        linksCount: data.links.length,
        datasetMode,
        periodLabel: `${currentStart}–${currentEnd}`
      };

      showSolverPanel = true;

      // 🔹 Evidenzia la prima maximum clique
      cliqueNodes = new Set(maxCliques[0]);
      refreshNodeVisuals();

      console.timeEnd("CLIQUE_TIME");

      clingoWorker.removeEventListener("message", handler);
      resolve();
    };

    clingoWorker.addEventListener("message", handler);

    clingoWorker.postMessage({
      type: "run",
      args: [
        fullProgram,
        0,
        ["--opt-mode=enum"]
      ]
    });
  });
}
let clingoWorker:Worker;
function computeMacroAreas() {
  const set = new Set<string>();

  for (const details of personDetailsMap.values()) {
    details.roles?.forEach(r => {
      if (r.macro_area) set.add(r.macro_area);
    });
  }

  availableMacroAreas = Array.from(set).sort();
}
  // ---------------- LIFECYCLE ----------------
  // ---------------- LIFECYCLE ----------------
onMount(() => {

  (async () => {

    // 1️⃣ Carico CSV dettagli
    await loadDetails();
    computeMacroAreas();

    // 2️⃣ Inizializzo Clingo
    clingoWorker = new Worker(
      new URL("./clingo/clingo.web.worker.js", import.meta.url),
      { type: "module" }
    );

    clingoWorker.postMessage({
      type: "init",
      wasmUrl: new URL("./clingo/clingo.wasm", import.meta.url).toString()
    });

    // 3️⃣ Inizializzo grafico
    graph3D = ForceGraph3D()(container)
      .nodeId("id")
      .nodeLabel("label")
      .backgroundColor("#050816")
      .nodeOpacity(0.95)
      .linkOpacity(0.4)
      .linkWidth(0.4);

    graph3D.nodeThreeObjectExtend(false);
    graph3D.nodeThreeObject((node: any) => makeNodeObject(node));

    graph3D.onNodeClick((node: any) => {
      rootSelectedId = node.id;
      selectedId = node.id;
      highlightedNeighbors = new Set();
      showSuggestions = false;
      startHistory(node.id);
      focusNode(node.id);
      selectNode(node.id);
      updateSelectedDetails(node.id);
      refreshNodeVisuals();
    });

    graph3D
      .forceEngine("d3")
      .d3Force("charge", forceManyBody().strength(-60))
      .d3Force("center", forceCenter())
      .d3Force("link", forceLink().distance(70).strength(0.5));

    loadDataset(datasetMode);

  })();

});
  onDestroy(() => {
  graph3D?._destructor?.();
  clingoWorker?.terminate();
});
</script>

<div bind:this={container} class="graph"></div>

<!-- TOOLBAR -->
<div class="toolbar">
<button on:click={runMaximumClique}>
  Run Maximum Clique
</button>

<button on:click={clearClique}>
  Clear Clique
</button>
  <img src="icon.png" alt="Icon" style="width:28px; height:28px; margin-right:6px;" />

  <div class="search-wrap">
    <input
      type="text"
      placeholder="Search node..."
      bind:value={query}
      on:input={() => rankCandidates(query)}
      on:keydown={(e) => {
        if (e.key === "Enter") {
          showSuggestions = false;
          searchNode(query);
        }
        if (e.key === "Escape") showSuggestions = false;
      }}
      on:focus={() => suggestions.length > 0 && query.trim().length >= 2 && (showSuggestions = true)}
      on:blur={() => setTimeout(() => (showSuggestions = false), 120)}
    />

    {#if showSuggestions}
      <div class="autocomplete">
        {#each suggestions as s}
          <div class="autocomplete-item" on:click={() => chooseSuggestion(s)}>{s}</div>
        {/each}
      </div>
    {/if}
  </div>

  <button on:click={() => (showSuggestions = false, searchNode(query))}>Search</button>
  <button on:click={resetView}>Reset</button>

  <div class="zoom-inline">
    <button on:click={zoomIn}>+</button>
    <button on:click={zoomOut}>−</button>
  </div>
</div>

<div class="filter-card">
  <strong>Visualizza:</strong>
  <label><input type="checkbox" checked={datasetMode === "all"} on:change={() => loadDataset("all")} /> Personaggi + Luoghi</label>
  <label><input type="checkbox" checked={datasetMode === "personaggi"} on:change={() => loadDataset("personaggi")} /> Personaggi</label>
  <label><input type="checkbox" checked={datasetMode === "luoghi"} on:change={() => loadDataset("luoghi")} /> Luoghi</label>
</div>

<InfoPanel
  {selectedNode}
  {selectedDetails}
  {rootSelectedId}
  neighborIds={Array.from(neighborMap.get(rootSelectedId ?? "") ?? [])}
  {highlightedNeighbors}
  onBackToRoot={backToRoot}
  onViewNeighbor={viewNeighbor}
  onCommitNeighbor={commitNeighbor}
/>

<HistoryPanel
  {history}
  onClear={clearHistory}
  onJumpTo={(id) => {
    // SOLO navigazione, NON alteriamo la history
    rootSelectedId = id;
    selectedId = id;
    highlightedNeighbors = new Set();
    focusNode(id);
    selectNode(id);
    refreshNodeVisuals();
  }}
/>

<TimelineSlider
  start={currentStart}
  end={currentEnd}
  on:change={(e) => {
    currentStart = e.detail.start;
    currentEnd = e.detail.end;

    clearTimeout(timelineTimeout);
    timelineTimeout = setTimeout(() => {
      applyTimelineFilter();
      graph3D?.d3ReheatSimulation?.();
    }, 140);
  }}
/>
<SolverPanel
  open={showSolverPanel}
  stats={solverStats}
  maximumCliques={maximumCliques}
  allCliques={allCliques}
  selectedNodeId={selectedId}
  bind:minSize={minCliqueSize}
  bind:topPerSize={topPerSize}
  bind:selectedMacroArea
  {availableMacroAreas}
  on:close={() => showSolverPanel = false}
  on:highlight={(e) => {
    cliqueNodes = new Set(e.detail);
    refreshNodeVisuals();
  }}
/>

<style>
  :global(body) {
    margin: 0;
    overflow: hidden;
    background: #020617;
    font-family: system-ui, sans-serif;
    color: #e2e8f0;
  }

  .graph {
    width: 100vw;
    height: 100vh;
  }

  .toolbar {
    position: absolute;
    top: 10px;
    left: 10px;
    display: flex;
    gap: 8px;
    align-items: center;
    background: rgba(15, 23, 42, 0.85);
    padding: 8px 10px;
    border-radius: 8px;
    z-index: 30; /* <-- prima era 10 */
  }

  .search-wrap {
    position: relative;
    display: flex;
    align-items: center;
  }

  .autocomplete {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    width: 320px;
    max-width: 56vw;
    background: rgba(15, 23, 42, 0.95);
    border-radius: 8px;
    overflow: hidden;
    z-index: 20;
    box-shadow: 0 10px 24px rgba(0, 0, 0, 0.35);
  }

  .autocomplete-item {
    padding: 6px 10px;
    cursor: pointer;
    font-size: 13px;
    line-height: 1.2;
    border-top: 1px solid rgba(148, 163, 184, 0.08);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .autocomplete-item:first-child {
    border-top: none;
  }

  .autocomplete-item:hover {
    background: rgba(56, 189, 248, 0.2);
  }

  .zoom-inline {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-left: 6px;
  }

  .filter-card {
    position: absolute;
    top: 64px;
    left: 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    background: rgba(15, 23, 42, 0.85);
    padding: 10px;
    border-radius: 8px;
    z-index: 10;
    font-size: 13px;
  }

  .filter-card label {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }

  .filter-card input[type="checkbox"] {
    accent-color: #38bdf8;
  }
</style>

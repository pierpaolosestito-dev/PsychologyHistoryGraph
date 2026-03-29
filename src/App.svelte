
<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import ForceGraph3D from "3d-force-graph";
  import * as THREE from "three";
  import { forceManyBody, forceCenter, forceLink } from "d3-force-3d";
  import GRAPH_CONFIG from "./config/graph.config.json";
  import TimelineSlider from "./components/TimelineSlider.svelte";
  import { getUnifiedGraph } from "./data/unifiedDataset";
  import InfoPanel from "./components/InfoPanel.svelte";
  import HistoryPanel from "./components/HistoryPanel.svelte";
  import SolverPanel from "./components/SolverPanel.svelte";
  const UI = GRAPH_CONFIG.ui;
  let container: HTMLDivElement;
  let graph3D: any;
  let clingoWorker: Worker;

  // ---------------- STATE ----------------
  let data: any = null;
  let originalData: any = null;
  let query = "";
  let currentStart = GRAPH_CONFIG.timeline.start;
  let currentEnd = GRAPH_CONFIG.timeline.end;
  let timelineTimeout: any = null;

  let rootSelectedId: string | null = null;
  let selectedId: string | null = null;
  let selectedNode: any = null;
  let selectedDetails: any = null;

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
    datasetMode: "unified" as string | undefined,
    periodLabel: undefined as string | undefined
  };

  let minCliqueSize = 3;
  let topPerSize = 5;

  // ---------------- FILTERS ----------------
  const filtersEnabled = GRAPH_CONFIG.filters?.enabled ?? true;
  const typeFiltersEnabled = GRAPH_CONFIG.filters?.types ?? true;
  const macroFiltersEnabled = GRAPH_CONFIG.filters?.macroAreas ?? false;

  let availableTypes: string[] = [];
  let availableMacroAreas: string[] = [];

  let selectedTypes = new Set<string>();
  let selectedMacroAreasFilter = new Set<string>();

  // ---------------- SOLVER MACRO FILTER ----------------
  let selectedMacroArea: string = "";

  // ---------------- HELPERS ----------------
  function atomize(s: string) {
    return (s ?? "")
      .trim()
      .replace(/\s+/g, " ")
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

  function getLinkEndId(end: any): string {
    return typeof end === "object" && end !== null ? end.id : end;
  }

  function getNodeById(id: string, nodes = data?.nodes ?? []): any | null {
    return nodes.find((n: any) => n.id === id) ?? null;
  }

  function buildUiDetails(node: any) {
  if (!node) return null;

  return {
    tipo: node.type ?? "unknown",
    titolo: node.label,
    ...node.data
  };
}

  function updateSelectedDetails(id: string) {
    const node = getNodeById(id);
    selectedDetails = buildUiDetails(node);
  }

  // ---------------- DATASET ----------------
  function computeDynamicFilters() {
    if (!originalData?.nodes) {
      availableTypes = [];
      availableMacroAreas = [];
      return;
    }

    const typeSet = new Set<string>();
    const macroSet = new Set<string>();

    for (const node of originalData.nodes) {
  if (node.type) typeSet.add(node.type);

  const macros = extractMacroAreas(node);
  macros.forEach(m => macroSet.add(m));
}

    availableTypes = Array.from(typeSet).sort();
    availableMacroAreas = Array.from(macroSet).sort();
  }

  function nodePassesTypeFilters(node: any) {
    if (!typeFiltersEnabled || selectedTypes.size === 0) return true;
    return selectedTypes.has(node.type);
  }

  function extractMacroAreas(node: any): string[] {
  const config = GRAPH_CONFIG.nodeTypes?.[node.type];

  if (!config?.macroAreaField) return [];

  if (config.macroAreaField === "roles[].macro_area") {
    return (node.data?.roles ?? [])
      .map((r: any) => r?.macro_area)
      .filter(Boolean);
  }

  return [];
}

  function nodePassesMacroFilters(node: any) {
  if (!macroFiltersEnabled || selectedMacroAreasFilter.size === 0) return true;

  return extractMacroAreas(node).some((m) =>
    selectedMacroAreasFilter.has(m)
  );
}

  function nodePassesTimeline(node: any) {
  const config = GRAPH_CONFIG.nodeTypes?.[node.type];

  if (!config || !config.timeline) return true;

  const start = node.data?.[config.timeline.startField] ?? 0;
  const end = node.data?.[config.timeline.endField] ?? 9999;

  return start <= currentEnd && end >= currentStart;
}

 function recomputeGraphData() {
  if (!originalData) return;

  const TIMELINE_CFG = GRAPH_CONFIG.timeline ?? {};
  const mode = TIMELINE_CFG.mode ?? "graph-aware";

  const visibleNodes = new Set<string>();

  // =========================================================
  // 🔹 MODE 1: GRAPH-AWARE (timeline intelligente)
  // =========================================================
  if (mode === "graph-aware") {

    const visibleTemporal = new Set<string>();

    // --- STEP 1: nodi temporali (es. person)
    for (const node of originalData.nodes) {
      const config = GRAPH_CONFIG.nodeTypes?.[node.type];

      if (!config || config.category !== "temporal") continue;
      if (!config.timeline) continue;

      const start = node.data?.[config.timeline.startField] ?? 0;
      const end = node.data?.[config.timeline.endField] ?? 9999;

      if (start <= currentEnd && end >= currentStart) {
        visibleTemporal.add(node.id);
      }
    }

    // --- STEP 2: espansione ai nodi collegati (es. place)
    const visibleRelated = new Set<string>();

    for (const link of originalData.links) {
      const s = getLinkEndId(link.source);
      const t = getLinkEndId(link.target);

      if (visibleTemporal.has(s)) visibleRelated.add(t);
      if (visibleTemporal.has(t)) visibleRelated.add(s);
    }

    // --- STEP 3: unione
    const expanded = new Set<string>([
      ...visibleTemporal,
      ...visibleRelated
    ]);

    // --- STEP 4: applica filtri (type + macro)
    for (const node of originalData.nodes) {
      if (!expanded.has(node.id)) continue;
      if (!nodePassesTypeFilters(node)) continue;
      if (!nodePassesMacroFilters(node)) continue;

      visibleNodes.add(node.id);
    }

  } else {

    // =========================================================
    // 🔹 MODE 2: SIMPLE (fallback vecchio comportamento)
    // =========================================================
    for (const node of originalData.nodes) {
      if (!nodePassesTypeFilters(node)) continue;
      if (!nodePassesMacroFilters(node)) continue;
      if (!nodePassesTimeline(node)) continue;

      visibleNodes.add(node.id);
    }
  }

  // =========================================================
  // 🔹 LINK FILTERING (coerente)
  // =========================================================
  const filteredLinks = originalData.links.filter((l: any) => {
    const s = getLinkEndId(l.source);
    const t = getLinkEndId(l.target);
    return visibleNodes.has(s) && visibleNodes.has(t);
  });

  const filteredNodes = originalData.nodes.filter((n: any) =>
    visibleNodes.has(n.id)
  );

  data = {
    nodes: filteredNodes,
    links: filteredLinks
  };

  // =========================================================
  // 🔹 rebuild neighbor map
  // =========================================================
  buildNeighborMap();

  // =========================================================
  // 🔹 reset selection se non più valida
  // =========================================================
  if (selectedId && !visibleNodes.has(selectedId)) {
    selectedId = null;
    rootSelectedId = null;
    selectedNode = null;
    selectedDetails = null;
    highlightedNeighbors = new Set();
  }

  // =========================================================
  // 🔹 update graph
  // =========================================================
  graph3D.graphData(data);
  refreshNodeVisuals();
}

  function loadDataset() {
    currentStart = GRAPH_CONFIG.timeline.start;
    currentEnd = GRAPH_CONFIG.timeline.end;

    rootSelectedId = null;
    selectedId = null;
    selectedNode = null;
    selectedDetails = null;
    highlightedNeighbors = new Set();
    cliqueNodes = new Set();
    clearHistory();

    const graph = getUnifiedGraph();

    originalData = {
  nodes: graph.nodes.map((n: any) => {
    const label = normalizeName(n.label);
    return {
      ...n,
      label,
      id: atomize(label)   // 🔥 FIX CRITICO
    };
  }),
  links: graph.edges.map((e: any) => ({
    source: atomize(e.source),
    target: atomize(e.target),
    type: e.type
  }))
};
    buildSearchIndexFromNodes(originalData.nodes);
    computeDynamicFilters();
    recomputeGraphData();

    graph3D.cameraPosition({ x: 0, y: 0, z: 220 }, { x: 0, y: 0, z: 0 }, 800);
  }

  // ---------------- HISTORY ----------------
  let history: { id: string; label: string }[] = [];

  

  function startHistory(id: string, label: string) {
  history = [{ id, label }];
}

 function pushHistory(id: string, label: string) {
  if (history[history.length - 1]?.id === id) return;
  history = [...history, { id, label }];
}

  function truncateHistoryTo(id: string) {
  const idx = history.findIndex(h => h.id === id);
  if (idx >= 0) history = history.slice(0, idx + 1);
}

  function clearHistory() {
    history = [];
  }

  // ---------------- AUTOCOMPLETE ----------------
  let searchIndex: { label: string; norm: string }[] = [];
  let suggestions: string[] = [];
  let showSuggestions = false;

  function buildSearchIndexFromNodes(nodes: any[]) {
    searchIndex = nodes.map((n) => ({
      label: n.label,
      norm: n.label.toLowerCase(),
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

  // ---------------- NODE STYLE ----------------
  function getNodeType(node: any): string {
    return node.type || "default";
  }

  function getNodeStyle(node: any) {
    const type = getNodeType(node);
    return GRAPH_CONFIG.nodeTypes[type] || GRAPH_CONFIG.nodeTypes.default;
  }

  const H = GRAPH_CONFIG.nodeTypes.highlight;

  const colorAccessor = (n: any) => {
    if (cliqueNodes.has(n.id)) return H.clique;

    if (!selectedId) {
      return getNodeStyle(n).color;
    }

    if (n.id === selectedId) return H.root;
    if (highlightedNeighbors.has(n.id)) return H.preview;
    if (neighborMap.get(selectedId)?.has(n.id)) return H.neighbor;

    return getNodeStyle(n).color;
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
  const textureCache = new Map<string, THREE.Texture>();

  function getTexture(path: string) {
  if (!path) return null;

  const safePath = path.startsWith("/") ? path : "/" + path;

  if (!textureCache.has(safePath)) {
    const tex = textureLoader.load(
      safePath,
      () => {
        // 🔥 quando la texture è pronta → refresh nodi
        refreshNodeVisuals();
      },
      undefined,
      () => {
        console.warn("❌ Texture non trovata:", safePath);
      }
    );

    tex.colorSpace = THREE.SRGBColorSpace;
    textureCache.set(safePath, tex);
  }

  return textureCache.get(safePath);
}

  const R = GRAPH_CONFIG.node.ring;
  const ringGeometry = new THREE.RingGeometry(R.innerRadius, R.outerRadius, R.segments);

  function makeIconSprite(node: any, size = 14, opacity = 1) {
    const style = getNodeStyle(node);

    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: getTexture(style.icon),
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
    const s = GRAPH_CONFIG.node.ring.scale;
    ring.scale.set(s, s, s);
    return ring;
  }

  function makeLabel(text: string, opacity = 1) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    const L = GRAPH_CONFIG.node.label;

    ctx.font = L.font;
    canvas.width = ctx.measureText(text).width + 20;
    canvas.height = 36;

    ctx.font = L.font;
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

    sprite.scale.set(L.scale[0], L.scale[1], 1);
    return sprite;
  }

  function makeNodeObject(node: any) {
  const group = new THREE.Group();
  const o = opacityForNode(node.id);

  const style = getNodeStyle(node);
  const tex = getTexture(style.icon);

  // 🔹 ICONA se disponibile
  if (tex) {
    group.add(makeIconSprite(node, GRAPH_CONFIG.node.iconSize, o));
  } else {
    // 🔥 fallback stabile
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(2.5, 16, 16),
      new THREE.MeshBasicMaterial({
        color: colorAccessor(node),
        transparent: true,
        opacity: o
      })
    );
    group.add(sphere);
  }

  // 🔹 ring sempre
  group.add(makeRing(colorAccessor(node), o));

  // 🔹 label
  const label = makeLabel(node.label, Math.max(0.18, o));
  const L = GRAPH_CONFIG.node.label;
  label.position.y = L.offsetY;
  group.add(label);

  return group;
}

  function refreshNodeVisuals() {
    graph3D.nodeThreeObject((node: any) => makeNodeObject(node));
  }

  // ---------------- GRAPH HELPERS ----------------
  function buildNeighborMap() {
    neighborMap = new Map();

    data.links.forEach((l: any) => {
      const s = getLinkEndId(l.source);
      const t = getLinkEndId(l.target);

      if (!neighborMap.has(s)) neighborMap.set(s, new Set());
      if (!neighborMap.has(t)) neighborMap.set(t, new Set());

      neighborMap.get(s)!.add(t);
      neighborMap.get(t)!.add(s);
    });
  }

  // ---------------- FILTER ACTIONS ----------------
  function toggleTypeFilter(type: string, checked: boolean) {
    const next = new Set(selectedTypes);
    if (checked) next.add(type);
    else next.delete(type);
    selectedTypes = next;
    recomputeGraphData();
  }

  function toggleMacroAreaFilter(macro: string, checked: boolean) {
    const next = new Set(selectedMacroAreasFilter);
    if (checked) next.add(macro);
    else next.delete(macro);
    selectedMacroAreasFilter = next;
    recomputeGraphData();
  }

  // ---------------- TIMELINE ----------------
  function applyTimelineFilter() {
    console.log("[TL] applyTimelineFilter", {
      currentStart,
      currentEnd,
      nodes: originalData?.nodes?.length
    });

    if (!originalData) return;

    recomputeGraphData();

    console.log("[TL] filteredNodes:", data.nodes.length);
    console.log("[TL] filteredLinks:", data.links.length);
  }

  // ---------------- INTERACTIONS ----------------
  
  function focusNode(id: string) {
  const node = data.nodes.find((n: any) => n.id === id);

  console.log("🎯 FOCUS NODE:", node);

  if (!node) {
    console.warn("❌ Nodo non presente nel grafo filtrato");
    return;
  }

  console.log("📍 POS:", node.x, node.y, node.z);

  if (node.x == null) {
    console.warn("❌ Nodo SENZA coordinate (simulation non pronta)");
    return;
  }

  graph3D.cameraPosition(
    { x: node.x * 2, y: node.y * 2, z: node.z * 2 + 40 },
    { x: node.x, y: node.y, z: node.z },
    900
  );
}

  function selectNode(id: string) {
    const node = data.nodes.find((n: any) => n.id === id);
    if (!node) return;

    const degree = data.links.filter((l: any) => {
      const s = getLinkEndId(l.source);
      const t = getLinkEndId(l.target);
      return s === id || t === id;
    }).length;

    selectedNode = { ...node, degree };
    updateSelectedDetails(id);
  }

  function viewNeighbor(id: string) {
    highlightedNeighbors = new Set([id]);
    focusNode(id);
    selectNode(id);
    refreshNodeVisuals();
  }

  function commitNeighbor(id: string, label: string = "") {
  rootSelectedId = id;
  selectedId = id;
  highlightedNeighbors = new Set();

  const node = getNodeById(id);
  pushHistory(id, node?.label ?? label ?? id);

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

  console.log("🔍 SEARCH:", text);

  const node = originalData.nodes.find((n: any) =>
    n.label.toLowerCase().includes(text)
  );

  console.log("🔍 FOUND NODE:", node);

  if (!node) {
    console.warn("❌ Nodo non trovato");
    return;
  }

  const id = node.id;

  console.log("🧠 ID:", id);

  rootSelectedId = id;
  selectedId = id;
  highlightedNeighbors = new Set();

  startHistory(node.id,node.label);

  const isVisible = data.nodes.find((n: any) => n.id === id);
  console.log("👁️ VISIBILE PRIMA?", !!isVisible);

  if (!isVisible) {
    console.log("♻️ RECOMPUTE GRAPH...");
    recomputeGraphData();
  }

  console.log("📊 NODO DOPO FILTER:", data.nodes.find(n => n.id === id));

  focusNode(id);
  selectNode(id);
  refreshNodeVisuals();
}

  function resetView() {
    rootSelectedId = null;
    selectedId = null;
    selectedNode = null;
    selectedDetails = null;
    highlightedNeighbors = new Set();
    cliqueNodes = new Set();
    suggestions = [];
    showSuggestions = false;
    clearHistory();

    selectedTypes = new Set();
    selectedMacroAreasFilter = new Set();

    currentStart = 1776;
    currentEnd = 2017;

    recomputeGraphData();
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

  // ---------------- ASP ----------------
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

  // ---------------- NODE INDEX ----------------
  for (const node of data.nodes) {
    indexMap.set(node.id, counter);
    reverseIndex[counter] = node.id;
    counter++;
  }

  let facts = "";

  // ---------------- NODE FACTS ----------------
  for (const [, idx] of indexMap) {
    facts += `node(${idx}).\n`;
  }

  // ---------------- MACRO FACTS (GENERIC) ----------------
  for (const node of data.nodes) {
    const idx = indexMap.get(node.id);
    if (!idx) continue;

    const macroAreas = extractMacroAreas(node);
    if (!macroAreas.length) continue;

    for (const macro of macroAreas) {
      const atom = atomize(macro);
      facts += `macro(${idx},${atom}).\n`;
    }
  }

  // ---------------- EDGE FACTS ----------------
  for (const link of data.links) {
    const sourceId = getLinkEndId(link.source);
    const targetId = getLinkEndId(link.target);

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

    const fullProgram = facts.trim() + "\n\n" + program.trim() + "\n";
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

        foundCliques.sort((a, b) => b.length - a.length);

        const maxSize = foundCliques[0].length;
        const maxCliques = foundCliques.filter(c => c.length === maxSize);

        console.log("🟢 Maximum Clique(s) on FILTERED graph: size =", maxSize);
        maxCliques.forEach((c, i) => console.log(`  Max ${i + 1}:`, c));

        console.log("⚪ Other Cliques (size > 1):");
        foundCliques
          .filter(c => c.length < maxSize)
          .forEach((c, i) => console.log(`  Clique ${i + 1} (size=${c.length}):`, c));

        const hist = new Map<number, number>();
        for (const c of foundCliques) {
          hist.set(c.length, (hist.get(c.length) ?? 0) + 1);
        }

        maximumCliques = maxCliques;
        allCliques = foundCliques;

        solverStats = {
          totalCliques: foundCliques.length,
          maxSize,
          histogram: hist,
          timeMs: t1 - t0,
          nodesCount: data.nodes.length,
          linksCount: data.links.length,
          datasetMode: "unified",
          periodLabel: `${currentStart}–${currentEnd}`
        };

        showSolverPanel = true;
        cliqueNodes = new Set(maxCliques[0]);
        //graph3D.refresh();

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

  function computeMacroAreas() {
  const set = new Set<string>();

  for (const node of originalData?.nodes ?? []) {
    extractMacroAreas(node).forEach(m => set.add(m));
  }

  availableMacroAreas = Array.from(set).sort();
}

  // ---------------- LIFECYCLE ----------------
  onMount(() => {
    (async () => {
      computeMacroAreas();

      clingoWorker = new Worker(
        new URL("./clingo/clingo.web.worker.js", import.meta.url),
        { type: "module" }
      );

      clingoWorker.postMessage({
        type: "init",
        wasmUrl: new URL("./clingo/clingo.wasm", import.meta.url).toString()
      });

      graph3D = ForceGraph3D()(container)
        .nodeId("id")
        .nodeLabel("label")
        .backgroundColor(GRAPH_CONFIG.graph.backgroundColor)
        .nodeOpacity(GRAPH_CONFIG.graph.nodeOpacity)
        .linkOpacity(GRAPH_CONFIG.graph.linkOpacity)
        .linkWidth(GRAPH_CONFIG.graph.linkWidth);

      graph3D.nodeThreeObjectExtend(false);
      graph3D.nodeThreeObject((node: any) => makeNodeObject(node));

      graph3D.onNodeClick((node: any) => {
        rootSelectedId = node.id;
        selectedId = node.id;
        highlightedNeighbors = new Set();
        showSuggestions = false;
        startHistory(node.id,node.label);
        focusNode(node.id);
        selectNode(node.id);
        updateSelectedDetails(node.id);
        refreshNodeVisuals();
      });

      const F = GRAPH_CONFIG.forces;
      graph3D
        .forceEngine("d3")
        .d3Force("charge", forceManyBody().strength(F.charge))
        .d3Force("center", forceCenter())
        .d3Force("link", forceLink().distance(F.linkDistance).strength(F.linkStrength));

      loadDataset();
      computeMacroAreas();
    })();
  });

  onDestroy(() => {
    graph3D?._destructor?.();
    clingoWorker?.terminate();
  });
</script>

<div
  class="app-root"
  style="
  --info-top: {UI.infoPanel.top}px;
--info-right: {UI.infoPanel.right}px;
--info-width: {UI.infoPanel.width}px;
--info-max-height: {UI.infoPanel.maxHeight}px;
--info-padding: {UI.infoPanel.padding}px;
--info-radius: {UI.infoPanel.borderRadius}px;
--info-bg: {UI.infoPanel.background};
--info-z: {UI.infoPanel.zIndex};

--info-title-size: {UI.infoPanel.title.fontSize}px;

--modal-backdrop: {UI.infoPanel.modal.backdrop};
--modal-z: {UI.infoPanel.modal.zIndex};

--modal-card-width: {UI.infoPanel.modal.cardWidth};
--modal-card-max-height: {UI.infoPanel.modal.cardMaxHeight};
--modal-card-bg: {UI.infoPanel.modal.cardBg};
--modal-card-radius: {UI.infoPanel.modal.cardRadius}px;

--modal-header-size: {UI.infoPanel.modal.headerFontSize}px;
--modal-header-border: {UI.infoPanel.modal.headerBorder};

--modal-body-padding: {UI.infoPanel.modal.bodyPadding}px;
--modal-line-height: {UI.infoPanel.modal.lineHeight};

--modal-footer-padding: {UI.infoPanel.modal.footerPadding};

--modal-close-bg: {UI.infoPanel.modal.closeBg};
--modal-close-color: {UI.infoPanel.modal.closeColor};
--solver-top: {UI.solverPanel.top}px;
--solver-right: {UI.solverPanel.right}px;
--solver-width: {UI.solverPanel.width}px;
--solver-max-height: {UI.solverPanel.maxHeight};
--solver-padding: {UI.solverPanel.padding}px;
--solver-radius: {UI.solverPanel.borderRadius}px;
--solver-bg: {UI.solverPanel.background};
--solver-shadow: {UI.solverPanel.shadow};
--solver-z: {UI.solverPanel.zIndex};
--solver-font-size: {UI.solverPanel.fontSize}px;

--solver-close-color: {UI.solverPanel.header.closeColor};

--solver-meta-opacity: {UI.solverPanel.meta.opacity};
--solver-meta-gap: {UI.solverPanel.meta.gap}px;

--solver-selected-bg: {UI.solverPanel.selectedAnalysis.background};
--solver-selected-padding: {UI.solverPanel.selectedAnalysis.padding}px;
--solver-selected-radius: {UI.solverPanel.selectedAnalysis.radius}px;
--solver-selected-mt: {UI.solverPanel.selectedAnalysis.marginTop}px;

--solver-controls-gap: {UI.solverPanel.controls.gap}px;
--solver-controls-mt: {UI.solverPanel.controls.marginTop}px;
--solver-controls-mb: {UI.solverPanel.controls.marginBottom}px;
--solver-input-width: {UI.solverPanel.controls.inputWidth}px;

--solver-cliques-mt: {UI.solverPanel.cliques.marginTop}px;
--solver-group-gap: {UI.solverPanel.cliques.groupGap}px;

--solver-item-padding: {UI.solverPanel.cliques.item.padding};
--solver-item-mb: {UI.solverPanel.cliques.item.marginBottom}px;
--solver-item-bg: {UI.solverPanel.cliques.item.background};
--solver-item-hover: {UI.solverPanel.cliques.item.hover};
--solver-item-radius: {UI.solverPanel.cliques.item.radius}px;
--solver-item-font: {UI.solverPanel.cliques.item.fontSize}px;

--solver-badge-bg: {UI.solverPanel.cliques.badge.bg};
--solver-badge-color: {UI.solverPanel.cliques.badge.color};
--solver-badge-font: {UI.solverPanel.cliques.badge.fontSize}px;
--solver-badge-padding: {UI.solverPanel.cliques.badge.padding};
--solver-badge-radius: {UI.solverPanel.cliques.badge.radius}px;
--history-left: {UI.historyPanel.left}px;
--history-bottom: {UI.historyPanel.bottom}px;
--history-max-width: {UI.historyPanel.maxWidth};
--history-padding: {UI.historyPanel.padding}px;
--history-radius: {UI.historyPanel.borderRadius}px;
--history-bg: {UI.historyPanel.background};
--history-z: {UI.historyPanel.zIndex};
--history-font: {UI.historyPanel.fontSize}px;
--history-color: {UI.historyPanel.textColor};

--history-header-mb: {UI.historyPanel.header.marginBottom}px;

--history-clear-bg: {UI.historyPanel.clearButton.background};
--history-clear-radius: {UI.historyPanel.clearButton.radius}px;
--history-clear-size: {UI.historyPanel.clearButton.size}px;

--history-gap: {UI.historyPanel.crumbs.gap}px;

--history-crumb-bg: {UI.historyPanel.crumb.background};
--history-crumb-hover: {UI.historyPanel.crumb.hover};
--history-crumb-padding: {UI.historyPanel.crumb.padding};
--history-crumb-radius: {UI.historyPanel.crumb.radius}px;
--history-crumb-max: {UI.historyPanel.crumb.maxWidth}px;

--history-sep-opacity: {UI.historyPanel.separator.opacity};
  --body-bg: {UI.body.background};
--body-color: {UI.body.textColor};
--body-font: {UI.body.fontFamily};

--toolbar-bg: {UI.toolbar.background};
--toolbar-z: {UI.toolbar.zIndex};

--zoom-margin-left: {UI.zoom.marginLeft}px;

--filter-bg: {UI.filterCard.background};
--filter-z: {UI.filterCard.zIndex};
--filter-max-width: {UI.filterCard.maxWidth}px;
--filter-max-height: {UI.filterCard.maxHeight};

--autocomplete-bg: {UI.autocomplete.background};
--autocomplete-radius: {UI.autocomplete.borderRadius}px;
--autocomplete-shadow: {UI.autocomplete.shadow};
--autocomplete-z: {UI.autocomplete.zIndex};
--autocomplete-offset-y: {UI.autocomplete.offsetY}px;
    --toolbar-top: {UI.toolbar.top}px;
    --toolbar-left: {UI.toolbar.left}px;
    --toolbar-gap: {UI.toolbar.spacing}px;
    --toolbar-padding: {UI.toolbar.padding};
    --toolbar-radius: {UI.toolbar.borderRadius}px;

    --search-width: {UI.search.width}px;
    --search-max-width: {UI.search.maxWidth};

    --zoom-gap: {UI.zoom.gap}px;

    --filter-top: {UI.filterCard.top}px;
    --filter-left: {UI.filterCard.left}px;
    --filter-padding: {UI.filterCard.padding}px;
    --filter-radius: {UI.filterCard.borderRadius}px;
    --filter-font-size: {UI.filterCard.fontSize}px;

    --autocomplete-item-padding: {UI.autocomplete.itemPadding};
    --autocomplete-font-size: {UI.autocomplete.fontSize}px;
  "
>
  <div bind:this={container} class="graph"></div>

<!-- TOOLBAR -->
<div class="toolbar">
  <button on:click={runMaximumClique}>
    Run Maximum Clique
  </button>

  <button on:click={clearClique}>
    Clear Clique
  </button>

  <img src="{GRAPH_CONFIG.ui.toolbar.icon}" alt="Icon" style="width:28px; height:28px; margin-right:6px;" />

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

{#if GRAPH_CONFIG.features.filters}
  <div class="filter-card">
    <strong>Filtri dinamici</strong>

    {#if typeFiltersEnabled}
      <div class="filter-section">
        <span class="filter-title">Tipi</span>
        {#each availableTypes as type}
          <label>
            <input
              type="checkbox"
              checked={selectedTypes.has(type)}
              on:change={(e) => toggleTypeFilter(type, (e.currentTarget as HTMLInputElement).checked)}
            />
            {type}
          </label>
        {/each}
      </div>
    {/if}

    {#if macroFiltersEnabled}
      <div class="filter-section">
        <span class="filter-title">Macro aree</span>
        {#each availableMacroAreas as macro}
          <label>
            <input
              type="checkbox"
              checked={selectedMacroAreasFilter.has(macro)}
              on:change={(e) => toggleMacroAreaFilter(macro, (e.currentTarget as HTMLInputElement).checked)}
            />
            {macro}
          </label>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<InfoPanel
  {selectedNode}
  {selectedDetails}
  {rootSelectedId}
  neighborIds={
  Array.from(neighborMap.get(rootSelectedId ?? "") ?? [])
    .map(id => {
      const node = getNodeById(id);
      return {
        id,
        label: node?.label ?? id
      };
    })
}
  {highlightedNeighbors}
  onBackToRoot={backToRoot}
  onViewNeighbor={viewNeighbor}
  onCommitNeighbor={(id) => {
  const node = getNodeById(id);
  commitNeighbor(id, node?.label ?? id);
}}
/>

<HistoryPanel
  {history}
  onClear={clearHistory}
  onJumpTo={(id) => {
    rootSelectedId = id;
    selectedId = id;
    highlightedNeighbors = new Set();
    truncateHistoryTo(id);
    focusNode(id);
    selectNode(id);
    refreshNodeVisuals();
  }}
/>

{#if GRAPH_CONFIG.features.timeline}
<TimelineSlider
  min={GRAPH_CONFIG.timeline.start}
  max={GRAPH_CONFIG.timeline.end}
  start={currentStart}
  end={currentEnd}
  on:change={(e) => {
    currentStart = e.detail.start;
    currentEnd = e.detail.end;

    clearTimeout(timelineTimeout);
    timelineTimeout = setTimeout(() => {
      applyTimelineFilter();
      graph3D?.d3ReheatSimulation?.();
    }, GRAPH_CONFIG.timeline.debounceMs);
  }}
/>
{/if}

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
</div>

<style>
  :global(body) {
    margin: 0;
    overflow: hidden;
    background: var(--body-bg);
    font-family: var(--body-font);
    color: var(--body-color);
  }

  .graph {
    width: 100vw;
    height: 100vh;
  }

  .toolbar {
    position: absolute;
    top: var(--toolbar-top);
    left: var(--toolbar-left);
    display: flex;
    gap: var(--toolbar-gap);
    align-items: center;
    background: var(--toolbar-bg);
    padding: var(--toolbar-padding);
    border-radius: var(--toolbar-radius);
    z-index: var(--toolbar-z);
  }

  .search-wrap {
    position: relative;
    display: flex;
    align-items: center;
  }

  .search-wrap input {
    width: var(--search-width);
    max-width: var(--search-max-width);
  }

  .autocomplete {
    position: absolute;
    top: calc(100% + var(--autocomplete-offset-y));
    left: 0;
    width: var(--search-width);
    max-width: var(--search-max-width);
    background: var(--autocomplete-bg);
    border-radius: var(--autocomplete-radius);
    overflow: hidden;
    z-index: var(--autocomplete-z);
    box-shadow: var(--autocomplete-shadow);
  }

  .autocomplete-item {
    padding: var(--autocomplete-item-padding);
    cursor: pointer;
    font-size: var(--autocomplete-font-size);
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
    background: var(--autocomplete-hover, rgba(56, 189, 248, 0.2));
  }

  .zoom-inline {
    display: flex;
    flex-direction: column;
    gap: var(--zoom-gap);
    margin-left: var(--zoom-margin-left);
  }

  .filter-card {
    position: absolute;
    top: var(--filter-top);
    left: var(--filter-left);
    display: flex;
    flex-direction: column;
    gap: 10px;
    background: var(--filter-bg);
    padding: var(--filter-padding);
    border-radius: var(--filter-radius);
    z-index: var(--filter-z);
    font-size: var(--filter-font-size);
    max-width: var(--filter-max-width);
    max-height: var(--filter-max-height);
    overflow-y: auto;
  }

  .filter-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .filter-title {
    font-weight: 600;
    color: var(--filter-title-color, #7dd3fc);
  }

  .filter-card label {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }

  .filter-card input[type="checkbox"] {
    accent-color: var(--filter-accent-color, #38bdf8);
  }
</style>
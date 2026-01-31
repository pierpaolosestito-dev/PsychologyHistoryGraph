<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import ForceGraph3D from "3d-force-graph";
  import Graph from "graphology";
  import * as THREE from "three";
  import { forceManyBody, forceCenter, forceLink } from "d3-force-3d";

  import { DATASETS, type DatasetMode } from "./data/datasets";
  import InfoPanel from "./components/InfoPanel.svelte";
  import HistoryPanel from "./components/HistoryPanel.svelte";

  let container: HTMLDivElement;
  let graph3D: any;

  // ---------------- STATE ----------------
  let data: any = null;
  let query = "";

  let rootSelectedId: string | null = null;
  let selectedId: string | null = null;
  let selectedNode: any = null;

  let neighborMap: Map<string, Set<string>> = new Map();
  let highlightedNeighbors = new Set<string>();

  let datasetMode: DatasetMode = "all";

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
    if (!selectedId) return colorFromString(n.id);
    if (n.id === selectedId) return "#facc15";
    if (highlightedNeighbors.has(n.id)) return "#7dd3fc";
    if (neighborMap.get(selectedId)?.has(n.id)) return "#60a5fa";
    return "#334155";
  };

  function opacityForNode(nodeId: string) {
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

    Object.entries(json).forEach(([src, targets]) => {
      if (!graph.hasNode(src)) graph.addNode(src, { label: src });
      targets.forEach((dst) => {
        if (!graph.hasNode(dst)) graph.addNode(dst, { label: dst });
        const key = [src, dst].sort().join("||");
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          graph.addEdge(src, dst);
        }
      });
    });

    const nodes: any[] = [];
    const links: any[] = [];
    graph.forEachNode((id, attrs) => nodes.push({ id, label: attrs.label }));
    graph.forEachEdge((_, __, s, t) => links.push({ source: s, target: t }));
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
    datasetMode = mode;
    rootSelectedId = null;
    selectedId = null;
    selectedNode = null;
    highlightedNeighbors = new Set();
    clearHistory();

    data = buildGraphFromJson(DATASETS[mode]);
    buildNeighborMap();
    buildSearchIndex(DATASETS[mode]);

    graph3D.graphData(data);
    refreshNodeVisuals();
    graph3D.cameraPosition({ x: 0, y: 0, z: 220 }, { x: 0, y: 0, z: 0 }, 800);
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
    const degree = data.links.filter((l: any) => l.source === id || l.target === id).length;
    selectedNode = { ...node, degree };
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
    suggestions = [];
    showSuggestions = false;
    clearHistory();
    refreshNodeVisuals();
    graph3D.cameraPosition({ x: 0, y: 0, z: 220 }, { x: 0, y: 0, z: 0 }, 800);
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

  // ---------------- LIFECYCLE ----------------
  onMount(() => {
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
      refreshNodeVisuals();
    });

    graph3D
      .forceEngine("d3")
      .d3Force("charge", forceManyBody().strength(-60))
      .d3Force("center", forceCenter())
      .d3Force("link", forceLink().distance(70).strength(0.5));

    loadDataset(datasetMode);
  });

  onDestroy(() => graph3D?._destructor?.());
</script>

<div bind:this={container} class="graph"></div>

<!-- TOOLBAR -->
<div class="toolbar">
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
    truncateHistoryTo(id);
    rootSelectedId = id;
    selectedId = id;
    highlightedNeighbors = new Set();
    focusNode(id);
    selectNode(id);
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

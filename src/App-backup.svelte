<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import ForceGraph3D from "3d-force-graph";
  import Graph from "graphology";
  import * as THREE from "three";
  import { forceManyBody, forceCenter, forceLink } from "d3-force-3d";

  import rawData from "./data/protagonisti_luoghi_relazioni.json";

  let container: HTMLDivElement;
  let graph3D: any;

  // ---------------- STATE ----------------
  let data: any = null;

  let query = "";
  let selectedId: string | null = null;       // nodo attualmente evidenziato
  let rootSelectedId: string | null = null;   // nodo principale (ricerca)
  let selectedNode: any = null;

  let neighborMap: Map<string, Set<string>> = new Map();
  let highlightedNeighbors = new Set<string>();

  // ---------------- COLOR UTILS ----------------
  function colorFromString(str: string) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 70%, 55%)`;
  }

  // ---------------- GRAPH BUILD ----------------
  function buildGraphFromJson(json: Record<string, string[]>) {
    const graph = new Graph({ type: "undirected" });
    const edgeSet = new Set<string>();

    Object.entries(json).forEach(([src, targets]) => {
      if (!graph.hasNode(src)) {
        graph.addNode(src, { label: src });
      }

      targets.forEach(dst => {
        if (!graph.hasNode(dst)) {
          graph.addNode(dst, { label: dst });
        }

        const key = [src, dst].sort().join("||");
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          graph.addEdge(src, dst);
        }
      });
    });

    const nodes: any[] = [];
    const links: any[] = [];

    graph.forEachNode((id, attrs) =>
      nodes.push({ id, label: attrs.label })
    );

    graph.forEachEdge((_, __, s, t) =>
      links.push({ source: s, target: t })
    );

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

  // ---------------- SEARCH ----------------
  function findNodeByLabel(q: string): string | null {
    const text = q.trim().toLowerCase();
    if (!text) return null;

    const exact = data.nodes.find(
      (n: any) => n.label.toLowerCase() === text
    );
    if (exact) return exact.id;

    const partial = data.nodes.find(
      (n: any) => n.label.toLowerCase().includes(text)
    );
    if (partial) return partial.id;

    return null;
  }

  function searchNode(q: string) {
    const id = findNodeByLabel(q);
    if (!id) return;

    rootSelectedId = id;
    focusNode(id);
    highlightNode(id);
    selectNode(id);
  }

  // ---------------- CAMERA / ZOOM ----------------
  function focusNode(id: string) {
    const node = data.nodes.find((n: any) => n.id === id);
    if (!node || node.x == null) return;

    graph3D.cameraPosition(
      { x: node.x * 2, y: node.y * 2, z: node.z * 2 + 40 },
      { x: node.x, y: node.y, z: node.z },
      900
    );
  }

  function zoomIn() {
    const cam = graph3D.camera();
    const dist = cam.position.length();
    graph3D.cameraPosition(
      { x: cam.position.x, y: cam.position.y, z: dist * 0.75 },
      undefined,
      300
    );
  }

  function zoomOut() {
    const cam = graph3D.camera();
    const dist = cam.position.length();
    graph3D.cameraPosition(
      { x: cam.position.x, y: cam.position.y, z: dist * 1.3 },
      undefined,
      300
    );
  }

  function resetView() {
    selectedId = null;
    rootSelectedId = null;
    selectedNode = null;
    highlightedNeighbors.clear();

    graph3D.nodeColor(colorAccessor);
    graph3D.cameraPosition({ x: 0, y: 0, z: 220 }, { x: 0, y: 0, z: 0 }, 800);
  }

  function goBackToRoot() {
    if (!rootSelectedId) return;
    focusNode(rootSelectedId);
    highlightNode(rootSelectedId);
    selectNode(rootSelectedId);
  }

  // ---------------- VISUALS ----------------
  function makeLabel(text: string) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    ctx.font = "26px sans-serif";
    const width = ctx.measureText(text).width + 20;
    canvas.width = width;
    canvas.height = 36;
    ctx.font = "26px sans-serif";
    ctx.fillStyle = "white";
    ctx.fillText(text, 10, 26);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(18, 8, 1);
    return sprite;
  }

  const colorAccessor = (n: any) => {
    if (!selectedId) return colorFromString(n.id);

    if (n.id === selectedId) return "#facc15";
    if (highlightedNeighbors.has(n.id)) return "#7dd3fc";

    const neighbors = neighborMap.get(selectedId);
    if (neighbors?.has(n.id)) return "#60a5fa";

    return "#334155";
  };

  function highlightNode(id: string) {
    selectedId = id;
    highlightedNeighbors.clear();
    graph3D.nodeColor(colorAccessor);
  }

  function selectNode(id: string) {
    const node = data.nodes.find((n: any) => n.id === id);
    const degree = data.links.filter(
      (l: any) => l.source === id || l.target === id
    ).length;

    selectedNode = { ...node, degree };
  }

  function toggleNeighbor(id: string) {
  highlightedNeighbors.clear();
  highlightedNeighbors.add(id);

  selectedId = id;          // 🔴 QUESTA ERA LA PARTE MANCANTE
  focusNode(id);
  selectNode(id);

  graph3D.nodeColor(colorAccessor);
}


  // ---------------- LIFECYCLE ----------------
  onMount(() => {
    data = buildGraphFromJson(rawData);
    buildNeighborMap();

    graph3D = ForceGraph3D()(container)
      .graphData(data)
      .nodeId("id")
      .nodeLabel("label")
      .backgroundColor("#050816")
      .nodeOpacity(0.95)
      .linkOpacity(0.4)
      .linkWidth(0.4);

    graph3D.nodeColor(colorAccessor);
    graph3D.nodeThreeObjectExtend(true);
    graph3D.nodeThreeObject((node: any) => makeLabel(node.label));

    graph3D.onNodeClick((node: any) => {
      rootSelectedId = node.id;
      focusNode(node.id);
      highlightNode(node.id);
      selectNode(node.id);
    });

    graph3D.forceEngine("d3")
      .d3Force("charge", forceManyBody().strength(-60))
      .d3Force("center", forceCenter())
      .d3Force("link", forceLink().distance(70).strength(0.5));

    graph3D.cameraPosition({ x: 0, y: 0, z: 220 }, { x: 0, y: 0, z: 0 }, 1200);
  });

  onDestroy(() => graph3D?._destructor?.());
</script>

<!-- GRAPH -->
<div bind:this={container} class="graph"></div>

<!-- TOOLBAR -->
<div class="toolbar">
  <img
    src="/icon.png"
    alt="Icon"
    style="width:28px; height:28px; margin-right:6px;"
  />

  <input
    type="text"
    placeholder="Search node..."
    bind:value={query}
    on:keydown={(e) => e.key === "Enter" && searchNode(query)}
  />
  <button on:click={() => searchNode(query)}>Search</button>
  <button on:click={resetView}>Reset</button>

  <div class="zoom-inline">
    <button on:click={zoomIn}>+</button>
    <button on:click={zoomOut}>−</button>
  </div>
</div>


<!-- INFO PANEL -->
{#if selectedNode}
  <div class="info-panel">
    <h3>{selectedNode.label}</h3>
    <p><strong>Degree:</strong> {selectedNode.degree}</p>

    {#if rootSelectedId && selectedId !== rootSelectedId}
      <button class="back-btn" on:click={goBackToRoot}>
        ⬅ Torna al nodo principale
      </button>
    {/if}

    <strong>Neighbors:</strong>
    <ul>
      {#each Array.from(neighborMap.get(selectedId) ?? []) as nid}
        <li>
          <label>
            <input
              type="checkbox"
              checked={highlightedNeighbors.has(nid)}
              on:change={() => toggleNeighbor(nid)}
            />
            {nid}
          </label>
        </li>
      {/each}
    </ul>
  </div>
{/if}

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
    z-index: 10;
  }

  .zoom-inline {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-left: 6px;
  }

  .info-panel {
    position: absolute;
    top: 10px;
    right: 10px;
    width: 260px;
    max-height: 340px;
    overflow-y: auto;
    background: rgba(15, 23, 42, 0.85);
    padding: 12px;
    border-radius: 8px;
    z-index: 10;
  }

  .back-btn {
    width: 100%;
    margin: 6px 0 10px;
    padding: 6px;
    border: none;
    border-radius: 4px;
    background: rgba(56, 189, 248, 0.2);
    color: #e2e8f0;
    cursor: pointer;
  }
</style>

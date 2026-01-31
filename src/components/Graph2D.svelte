<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import ForceGraph from "force-graph";
  import { forceManyBody, forceCenter, forceLink } from "d3-force";

  export let data: any;
  export let selectedId: string | null = null;
  export let highlightedNeighbors: Set<string> = new Set();
  export let neighborMap: Map<string, Set<string>> = new Map();

  export let onNodeClick: (id: string) => void;

  let container: HTMLDivElement;
  let graph: any;

  // --------- ICON ---------
  const iconImg = new Image();
  iconImg.src = "icon.png";

  // --------- COLOR / OPACITY (stessa semantica del 3D) ---------
  function colorFromString(str: string) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return `hsl(${Math.abs(hash) % 360}, 70%, 55%)`;
  }

  function nodeColor(node: any) {
    if (!selectedId) return colorFromString(node.id);
    if (node.id === selectedId) return "#facc15";
    if (highlightedNeighbors.has(node.id)) return "#7dd3fc";
    if (neighborMap.get(selectedId)?.has(node.id)) return "#60a5fa";
    return "#334155";
  }

  function nodeOpacity(nodeId: string) {
    if (!selectedId) return 1;
    if (nodeId === selectedId) return 1;
    if (highlightedNeighbors.has(nodeId)) return 1;
    if (neighborMap.get(selectedId)?.has(nodeId)) return 0.95;
    return 0.22;
  }

  // --------- CUSTOM NODE DRAW ---------
  function drawNode(
    node: any,
    ctx: CanvasRenderingContext2D,
    globalScale: number
  ) {
    const size = 14;
    const opacity = nodeOpacity(node.id);

    ctx.save();
    ctx.globalAlpha = opacity;

    // icona (centrata)
    if (iconImg.complete) {
      ctx.drawImage(
        iconImg,
        node.x - size / 2,
        node.y - size / 2,
        size,
        size
      );
    }

    // ring (come nel 3D)
    ctx.beginPath();
    ctx.arc(node.x, node.y, size * 0.65, 0, 2 * Math.PI);
    ctx.strokeStyle = nodeColor(node);
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.restore();
  }

  function refresh() {
    if (!graph) return;
    graph.refresh();
  }

  // --------- LIFECYCLE ---------
  onMount(() => {
    graph = ForceGraph()(container)
      .graphData(data)
      .backgroundColor("#050816")
      .nodeCanvasObject(drawNode)
      .nodeLabel((node: any) => node.label) // hover tooltip
      .nodePointerAreaPaint(
        (node: any, color: string, ctx: CanvasRenderingContext2D) => {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(node.x, node.y, 10, 0, 2 * Math.PI);
          ctx.fill();
        }
      )
      .linkColor(() => "rgba(148,163,184,0.25)")
      .linkWidth(0.6)
      .onNodeClick((node: any) => {
        onNodeClick?.(node.id);
      });

    graph
      .d3Force("charge", forceManyBody().strength(-120))
      .d3Force("center", forceCenter())
      .d3Force("link", forceLink().distance(70).strength(0.6));

    graph.zoomToFit(400);
  });

  onDestroy(() => {
    graph?._destructor?.();
  });

  // --------- REACTIVITY ---------
  $: refresh();
</script>

<div bind:this={container} class="graph2d"></div>

<style>
  .graph2d {
    width: 100vw;
    height: 100vh;
    background: #050816;
  }
</style>

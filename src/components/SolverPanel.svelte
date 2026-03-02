<script lang="ts">
  import { createEventDispatcher } from "svelte";

  export let open: boolean = false;

  export let stats: {
    totalCliques: number;
    maxSize: number;
    histogram: Map<number, number>;
    timeMs?: number;
    nodesCount?: number;
    linksCount?: number;
    datasetMode?: string;
    periodLabel?: string;
  };

  export let maximumCliques: string[][] = [];
  export let allCliques: string[][] = [];

  export let selectedNodeId: string | null = null;

  // ⚠️ QUESTI DEVONO RESTARE export per il bind
  export let minSize: number = 3;
  export let topPerSize: number = 5;

  const dispatch = createEventDispatcher();

  let showOnlyMaximum = false;
  let showAll = false;
  let filterBySelectedNode = false;

  function highlightClique(c: string[]) {
    dispatch("highlight", c);
  }

  function closePanel() {
    dispatch("close");
  }

  function getFilteredCliques() {
    let base = allCliques ?? [];

    if (showOnlyMaximum) {
      base = maximumCliques;
    }

    if (filterBySelectedNode && selectedNodeId) {
      base = base.filter(c => c.includes(selectedNodeId));
    }

    base = base.filter(c => c.length >= minSize);

    return base;
  }

  $: filteredCliques = getFilteredCliques();
  $: grouped = groupCliques(filteredCliques);

  // Analisi nodo selezionato
  $: selectedCliqueCount =
    selectedNodeId
      ? allCliques.filter(c => c.includes(selectedNodeId)).length
      : 0;

  $: selectedInMaximum =
    selectedNodeId
      ? maximumCliques.some(c => c.includes(selectedNodeId))
      : false;

  function groupCliques(cliques: string[][]) {
    const map = new Map<number, string[][]>();

    for (const c of cliques) {
      if (!map.has(c.length)) map.set(c.length, []);
      map.get(c.length)!.push(c);
    }

    const sizes = Array.from(map.keys()).sort((a,b)=>b-a);

    return sizes.map(size => ({
      size,
      cliques: showAll
        ? map.get(size)!
        : map.get(size)!.slice(0, topPerSize)
    }));
  }

  function downloadCSV() {
    if (!filteredCliques?.length) return;

    let csv = "size,clique\n";

    for (const c of filteredCliques) {
      csv += `${c.length},"${c.join(" | ")}"\n`;
    }

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "cliques_export.csv";
    a.click();

    URL.revokeObjectURL(url);
  }
</script>

{#if open}
<div class="solver-panel">

  <div class="solver-header">
    <h3>ASP Clique Analysis</h3>
    <button class="close-btn" on:click={closePanel}>✕</button>
  </div>

  <!-- META -->
  <div class="solver-meta">
    <div><strong>Total cliques:</strong> {stats?.totalCliques}</div>
    <div><strong>Maximum size:</strong> {stats?.maxSize}</div>

    {#if stats?.timeMs}
      <div><strong>Solver time:</strong> {stats.timeMs.toFixed(2)} ms</div>
    {/if}

    {#if stats?.nodesCount}
      <div><strong>Nodes:</strong> {stats.nodesCount}</div>
    {/if}

    {#if stats?.linksCount}
      <div><strong>Edges:</strong> {stats.linksCount}</div>
    {/if}

    {#if stats?.periodLabel}
      <div><strong>Period:</strong> {stats.periodLabel}</div>
    {/if}
  </div>

  <!-- ANALISI NODO SELEZIONATO -->
  {#if selectedNodeId}
  <div class="selected-analysis">
    <div><strong>Selected node:</strong> {selectedNodeId}</div>
    <div><strong>Cliques containing it:</strong> {selectedCliqueCount}</div>
    <div>
      <strong>In maximum clique:</strong>
      {selectedInMaximum ? "YES" : "NO"}
    </div>
  </div>
  {/if}

  <!-- CONTROLS -->
  <div class="solver-controls">

    <label>
      Min clique size
      <input type="number" bind:value={minSize} min="2" />
    </label>

    <label>
      Top per size
      <input type="number" bind:value={topPerSize} min="1" max="50" />
    </label>

    <label>
      <input type="checkbox" bind:checked={showOnlyMaximum} />
      Only maximum cliques
    </label>

    <label>
      <input type="checkbox" bind:checked={showAll} />
      Show all (no top limit)
    </label>

    {#if selectedNodeId}
    <label>
      <input type="checkbox" bind:checked={filterBySelectedNode} />
      Only cliques containing "{selectedNodeId}"
    </label>
    {/if}

    <button on:click={downloadCSV}>
      Download CSV (filtered)
    </button>

  </div>

  <!-- HISTOGRAM -->
  <div class="solver-histogram">
    <h4>Distribution by size</h4>
    {#if stats?.histogram}
      {#each Array.from(stats.histogram.entries()).sort((a,b)=>b[0]-a[0]) as [size,count]}
        <div class="hist-line">
          size {size} → {count}
        </div>
      {/each}
    {/if}
  </div>

  <!-- CLIQUES -->
  <div class="solver-cliques">
    <h4>Cliques</h4>

    {#if grouped.length === 0}
      <div class="empty">No cliques for current filters.</div>
    {/if}

    {#each grouped as group}
      <div class="size-group">
        <div class="size-title">
          Size {group.size}
        </div>

        {#each group.cliques as c}
          <div class="clique-item" on:click={() => highlightClique(c)}>
            {c.join(", ")}
            {#if c.length === stats?.maxSize}
              <span class="max-badge">MAX</span>
            {/if}
          </div>
        {/each}
      </div>
    {/each}
  </div>

</div>
{/if}

<style>
  .solver-panel {
    position: absolute;
    right: 20px;
    top: 20px;
    width: 420px;
    max-height: 85vh;
    overflow-y: auto;
    background: rgba(15, 23, 42, 0.97);
    padding: 18px;
    border-radius: 14px;
    box-shadow: 0 20px 40px rgba(0,0,0,0.5);
    z-index: 50;
    font-size: 13px;
  }

  .solver-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .close-btn {
    background: none;
    border: none;
    color: white;
    cursor: pointer;
    font-size: 16px;
  }

  .solver-meta div {
    margin-bottom: 4px;
    opacity: 0.85;
  }

  .selected-analysis {
    margin-top: 10px;
    padding: 10px;
    background: rgba(99,102,241,0.15);
    border-radius: 8px;
  }

  .solver-controls {
    margin-top: 14px;
    margin-bottom: 14px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .solver-controls input[type="number"] {
    width: 70px;
    margin-left: 6px;
  }

  .solver-histogram {
    margin-top: 12px;
  }

  .hist-line {
    opacity: 0.8;
  }

  .solver-cliques {
    margin-top: 14px;
  }

  .size-group {
    margin-bottom: 12px;
  }

  .size-title {
    font-weight: 600;
    margin-bottom: 6px;
  }

  .clique-item {
    padding: 6px 8px;
    margin-bottom: 4px;
    background: rgba(56,189,248,0.18);
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
    display: flex;
    justify-content: space-between;
  }

  .clique-item:hover {
    background: rgba(56,189,248,0.35);
  }

  .max-badge {
    font-size: 10px;
    background: #facc15;
    color: black;
    padding: 2px 4px;
    border-radius: 4px;
    margin-left: 6px;
  }

  .empty {
    opacity: 0.6;
  }
</style>
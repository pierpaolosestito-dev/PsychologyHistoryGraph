<script lang="ts">
  // Props dal parent (App.svelte)
  export let selectedNode: any = null;
  export let rootSelectedId: string | null = null;
  export let neighborIds: string[] = [];
  export let highlightedNeighbors: Set<string> = new Set();

  // callbacks dal parent
  export let onBackToRoot: () => void;
  export let onViewNeighbor: (id: string) => void;
  export let onCommitNeighbor: (id: string) => void;

  // ---- MODAL (placeholder) ----
  let showModal = false;

  function openModal() {
    showModal = true;
  }
  function closeModal() {
    showModal = false;
  }

  // Chiudi con ESC
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") closeModal();
  }

  // click su backdrop chiude
  function onBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) closeModal();
  }
</script>

{#if selectedNode}
  <div class="info-panel">
    <!-- Titolo cliccabile -->
    <button class="title-btn" type="button" on:click={openModal}>
      <h3>{selectedNode.label}</h3>
    </button>

    <p><strong>Degree:</strong> {selectedNode.degree}</p>

    {#if rootSelectedId && selectedNode.id !== rootSelectedId}
      <button class="back-btn" type="button" on:click={onBackToRoot}>
        Torna al nodo principale
      </button>
    {/if}

    <strong>Neighbors:</strong>
    <ul>
      {#each neighborIds as nid}
        <li style="display:flex; align-items:center; gap:6px;">
          <label style="flex:1; display:flex; align-items:center; gap:6px;">
            <input
              type="checkbox"
              checked={highlightedNeighbors.has(nid)}
              on:change={(e) => {
                const checked = (e.currentTarget as HTMLInputElement).checked;
                if (checked) onViewNeighbor(nid);
                else onBackToRoot();
              }}
            />
            {nid}
          </label>

          <button
            title="Esplora questo nodo"
            type="button"
            on:click={() => onCommitNeighbor(nid)}
            class="explore-btn"
          >
            →
          </button>
        </li>
      {/each}
    </ul>
  </div>

  <!-- MODAL PLACEHOLDER -->
  {#if showModal}
    <div
      class="modal-backdrop"
      role="dialog"
      aria-modal="true"
      on:click={onBackdropClick}
      on:keydown={handleKeydown}
      tabindex="0"
    >
      <div class="modal-card">
        <div class="modal-header">Test</div>
        <div class="modal-body">Test</div>
        <div class="modal-footer">Test</div>

        <button class="modal-close" type="button" on:click={closeModal} aria-label="Chiudi">
          ✕
        </button>
      </div>
    </div>
  {/if}
{/if}

<style>
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

  .title-btn {
    width: 100%;
    text-align: left;
    background: transparent;
    border: none;
    padding: 0;
    margin: 0 0 6px 0;
    cursor: pointer;
    color: inherit;
  }

  .title-btn h3 {
    margin: 0;
    font-size: 16px;
    line-height: 1.2;
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .title-btn:hover h3 {
    opacity: 0.9;
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

  .explore-btn {
    border: none;
    background: rgba(255, 255, 255, 0.08);
    color: #e2e8f0;
    cursor: pointer;
    border-radius: 4px;
    padding: 2px 6px;
  }

  /* ---------- MODAL ---------- */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(2, 6, 23, 0.7);
    z-index: 999;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 18px;
    outline: none;
  }

  .modal-card {
    width: min(520px, 92vw);
    background: rgba(15, 23, 42, 0.98);
    border-radius: 12px;
    box-shadow: 0 18px 60px rgba(0, 0, 0, 0.55);
    border: 1px solid rgba(148, 163, 184, 0.14);
    position: relative;
    overflow: hidden;
  }

  .modal-header,
  .modal-footer {
    padding: 12px 14px;
    background: rgba(2, 6, 23, 0.35);
    font-weight: 600;
  }

  .modal-body {
    padding: 14px;
  }

  .modal-close {
    position: absolute;
    top: 10px;
    right: 10px;
    border: none;
    background: rgba(255, 255, 255, 0.08);
    color: #e2e8f0;
    border-radius: 8px;
    width: 32px;
    height: 32px;
    cursor: pointer;
  }
</style>

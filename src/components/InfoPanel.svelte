<script lang="ts">
  import type { NodeDetails } from "../data/details";

  // Props dal parent
  export let selectedNode: any = null;
  export let selectedDetails: NodeDetails | null = null;
  export let rootSelectedId: string | null = null;
  export let neighborIds: string[] = [];
  export let highlightedNeighbors: Set<string> = new Set();

  export let onBackToRoot: () => void;
  export let onViewNeighbor: (id: string) => void;
  export let onCommitNeighbor: (id: string) => void;

  let showModal = false;

  function openModal() {
    showModal = true;
  }

  function closeModal() {
    showModal = false;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") closeModal();
  }

  function onBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) closeModal();
  }
</script>

{#if selectedNode}
  <div class="info-panel">
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

        <!-- HEADER -->
        <div class="modal-header">
          {selectedNode.label}
        </div>

        <!-- BODY -->
        <div class="modal-body">

          {#if selectedDetails}

            {#if selectedDetails.tipo === "person"}

              <p><strong>Nascita:</strong>
                {selectedDetails.luogo_nascita}
                {#if selectedDetails.anno_nascita}
                  ({selectedDetails.anno_nascita})
                {/if}
              </p>

              {#if selectedDetails.anno_morte}
                <p><strong>Morte:</strong> {selectedDetails.anno_morte}</p>
              {/if}

              {#if selectedDetails.periodo}
                <p><strong>Periodo:</strong> {selectedDetails.periodo}</p>
              {/if}

              <hr />

              {#if selectedDetails.biografia_html}
                <div class="biografia">
                  {@html selectedDetails.biografia_html}
                </div>
              {/if}

            {:else if selectedDetails.tipo === "place"}

              {#if selectedDetails.immagine_url}
                <img
                  src={selectedDetails.immagine_url}
                  alt={selectedDetails.titolo}
                  class="place-image"
                />
              {/if}

              {#if selectedDetails.citta}
                <p><strong>Città:</strong> {selectedDetails.citta}</p>
              {/if}

              {#if selectedDetails.contenuto}
                <div class="contenuto">
                  {@html selectedDetails.contenuto}
                </div>
              {/if}

            {/if}

          {:else}
            <p>Nessun dettaglio disponibile.</p>
          {/if}

        </div>

        <!-- FOOTER -->
        <div class="modal-footer">
          <button class="modal-close" type="button" on:click={closeModal}>
            ✕
          </button>
        </div>

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
    text-decoration: underline;
  }

  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(2, 6, 23, 0.7);
    z-index: 999;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 18px;
  }

  .modal-card {
    width: min(720px, 92vw);
    max-height: 85vh;
    overflow-y: auto;
    background: rgba(15, 23, 42, 0.98);
    border-radius: 12px;
    padding-bottom: 20px;
  }

  .modal-header {
    padding: 16px;
    font-size: 20px;
    font-weight: 600;
    border-bottom: 1px solid rgba(148, 163, 184, 0.2);
  }

  .modal-body {
    padding: 16px;
    line-height: 1.6;
  }

  .biografia {
    font-size: 14px;
  }

  .place-image {
    width: 100%;
    border-radius: 8px;
    margin-bottom: 12px;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    padding: 12px 16px;
  }

  .modal-close {
    border: none;
    background: rgba(255, 255, 255, 0.08);
    color: #e2e8f0;
    border-radius: 8px;
    width: 36px;
    height: 36px;
    cursor: pointer;
  }
</style>
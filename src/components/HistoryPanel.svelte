<script lang="ts">
  export let history: string[] = [];
  export let onJumpTo: (id: string) => void;
  export let onClear: () => void;
</script>

{#if history.length > 0}
  <div class="history-panel">
    <div class="history-head">
      <strong>History</strong>
      <button class="clear-btn" type="button" on:click={onClear} title="Clear history">✕</button>
    </div>

    <div class="crumbs">
      {#each history as id, i}
        <button class="crumb" type="button" on:click={() => onJumpTo(id)}>
          {id}
        </button>
        {#if i < history.length - 1}
          <span class="sep">→</span>
        {/if}
      {/each}
    </div>
  </div>
{/if}

<style>
  .history-panel {
    position: absolute;
    left: 10px;
    bottom: 10px;
    max-width: min(560px, 92vw);
    background: rgba(15, 23, 42, 0.85);
    border-radius: 8px;
    padding: 10px;
    z-index: 15;
    font-size: 13px;
    color: #e2e8f0;
  }

  .history-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .clear-btn {
    border: none;
    background: rgba(255,255,255,0.08);
    color: inherit;
    border-radius: 6px;
    width: 28px;
    height: 28px;
    cursor: pointer;
  }

  .crumbs {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }

  .crumb {
    border: none;
    background: rgba(56, 189, 248, 0.12);
    color: inherit;
    border-radius: 999px;
    padding: 4px 8px;
    cursor: pointer;
    white-space: nowrap;
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .crumb:hover {
    background: rgba(56, 189, 248, 0.22);
  }

  .sep {
    opacity: 0.6;
  }
</style>

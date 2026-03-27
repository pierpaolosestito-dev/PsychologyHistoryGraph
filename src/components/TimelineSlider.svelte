<script lang="ts">
  import { createEventDispatcher } from "svelte";

  const dispatch = createEventDispatcher();

  export let min:number;
  export let max:number;

  // ✅ controllati dal parent (App.svelte)
  export let start = min;
  export let end = max;

  // ✅ stato interno (per drag fluido)
  let localStart = start;
  let localEnd = end;

  // ✅ quando il parent cambia start/end (es. loadDataset reset),
  // aggiorniamo la UI del componente
  $: if (start !== localStart) localStart = start;
  $: if (end !== localEnd) localEnd = end;

  function emit() {
    dispatch("change", { start: localStart, end: localEnd });
  }

  function updateStart(e: Event) {
    const value = Number((e.target as HTMLInputElement).value);
    localStart = Math.min(value, localEnd);
    emit();
  }

  function updateEnd(e: Event) {
    const value = Number((e.target as HTMLInputElement).value);
    localEnd = Math.max(value, localStart);
    emit();
  }
</script>

<div class="timeline-container">
  <div class="timeline-label">
    <span>{localStart}</span>
    <span>—</span>
    <span>{localEnd}</span>
  </div>

  <div class="slider-wrapper">
    <input
      type="range"
      min={min}
      max={max}
      value={localStart}
      on:input={updateStart}
      class="slider slider-start"
    />

    <input
      type="range"
      min={min}
      max={max}
      value={localEnd}
      on:input={updateEnd}
      class="slider slider-end"
    />
  </div>
</div>

<style>
  .timeline-container {
    position: absolute;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    width: min(800px, 90vw);
    background: rgba(15, 23, 42, 0.85);
    padding: 16px 24px;
    border-radius: 16px;
    backdrop-filter: blur(8px);
    box-shadow: 0 10px 30px rgba(0,0,0,0.4);
    z-index: 25;
  }

  .timeline-label {
    display: flex;
    justify-content: center;
    gap: 12px;
    font-size: 18px;
    font-weight: 600;
    margin-bottom: 12px;
  }

  .slider-wrapper {
    position: relative;
    height: 40px;
  }

  .slider {
    position: absolute;
    width: 100%;
    pointer-events: none;
    -webkit-appearance: none;
    background: transparent;
  }

  .slider::-webkit-slider-thumb {
    pointer-events: all;
    -webkit-appearance: none;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #38bdf8;
    border: 2px solid white;
    cursor: pointer;
  }

  .slider::-webkit-slider-runnable-track {
    height: 6px;
    border-radius: 6px;
    background: linear-gradient(to right, #334155, #334155);
  }
</style>
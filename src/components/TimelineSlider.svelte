<script lang="ts">
  import { createEventDispatcher } from "svelte";

  const dispatch = createEventDispatcher();

  export let min = 1776;
  export let max = 2017;

  // 🔹 Range controllato dal parent
  export let start: number;
  export let end: number;

  function emit() {
    dispatch("change", { start, end });
  }

  function updateStart(e: Event) {
    const value = Number((e.target as HTMLInputElement).value);
    start = Math.min(value, end);
    emit();
  }

  function updateEnd(e: Event) {
    const value = Number((e.target as HTMLInputElement).value);
    end = Math.max(value, start);
    emit();
  }
</script>

<div class="timeline-container">
  <div class="timeline-label">
    <span>{start}</span>
    <span>—</span>
    <span>{end}</span>
  </div>

  <div class="slider-wrapper">
    <input
      type="range"
      min={min}
      max={max}
      bind:value={start}
      on:input={updateStart}
      class="slider slider-start"
    />

    <input
      type="range"
      min={min}
      max={max}
      bind:value={end}
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
/**
 * Main Application Controller for goBankV2
 * Vertical Timelines Schedule with Live DB Account Sync & Non-overlapping Layout
 */

(function () {
  const STATE = {
    txCount: 2,
    maxSteps: 8,
    mode: 'SIMULATE', // 'SIMULATE' or 'FIX'
    accounts: { A: 1000, B: 1000, C: 1000 },
    currentSchedule: [],
    lastResult: null,
  };

  // DOM Elements
  const txCountButtons = document.querySelectorAll('.tx-btn');
  const txCountSelect = document.getElementById('txCountSelect');
  const verticalScheduleMatrix = document.getElementById('verticalScheduleMatrix');
  const verticalScheduleWrapper = document.getElementById('verticalScheduleWrapper');
  const btnAddStepRow = document.getElementById('btnAddStepRow');
  const stepRowsCountHint = document.getElementById('stepRowsCountHint');

  const sequenceStream = document.getElementById('sequenceStream');
  const sequenceCount = document.getElementById('sequenceCount');
  const btnMainAction = document.getElementById('btnMainAction');
  const actionButtonText = document.getElementById('actionButtonText');
  const actionIcon = document.getElementById('actionIcon');
  const actionSpinner = document.getElementById('actionSpinner');
  const btnClearTimeline = document.getElementById('btnClearTimeline');
  const btnLoadPreset = document.getElementById('btnLoadPreset');
  const presetSelect = document.getElementById('presetScenarioSelect');
  const btnResetDB = document.getElementById('btnResetDB');

  const paletteAccount = document.getElementById('paletteAccount');
  const paletteDelta = document.getElementById('paletteDelta');
  const paletteReadAccountBadge = document.getElementById('paletteReadAccountBadge');
  const paletteReadDesc = document.getElementById('paletteReadDesc');
  const paletteWriteAmountBadge = document.getElementById('paletteWriteAmountBadge');
  const paletteWriteDesc = document.getElementById('paletteWriteDesc');

  const hazardsContent = document.getElementById('hazardsContent');
  const serializableBadge = document.getElementById('serializableBadge');
  const statusDot = document.getElementById('statusDot');
  const traceLogContainer = document.getElementById('traceLogContainer');
  const precedenceSvg = document.getElementById('precedenceSvg');

  // Account Balance Elements
  const balA = document.getElementById('balAccountA');
  const balB = document.getElementById('balAccountB');
  const balC = document.getElementById('balAccountC');

  // ==========================================================================
  // Initialization
  // ==========================================================================

  function init() {
    setupEventListeners();
    window.DragDropModule.init(handleScheduleModified);
    renderVerticalSchedule();
    fetchAccountBalances();
    // Load default educational scenario
    loadPreset('lost_update');
  }

  function setupEventListeners() {
    // Transaction Count Selector
    function handleTxCountChange(count) {
      setTxCount(count);
      const defaultPresets = {
        1: 'tx1_atomic_transfer',
        2: 'lost_update',
        3: 'tx3_circular_deadlock',
        4: 'tx4_ring_deadlock',
      };
      const preset = defaultPresets[count] || 'lost_update';
      loadPreset(preset);
    }

    if (txCountSelect) {
      txCountSelect.addEventListener('change', () => {
        handleTxCountChange(parseInt(txCountSelect.value, 10));
      });
    }

    txCountButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        handleTxCountChange(parseInt(btn.getAttribute('data-count'), 10));
      });
    });

    // Main Simulate / Fix Action Button
    if (btnMainAction) {
      btnMainAction.addEventListener('click', handleMainActionClick);
    }

    // Clear Timeline
    if (btnClearTimeline) {
      btnClearTimeline.addEventListener('click', () => {
        clearAllSlots();
        resetToSimulateState();
        showToast('Timelines cleared.');
      });
    }

    // Preset Scenarios
    if (btnLoadPreset) {
      btnLoadPreset.addEventListener('click', () => {
        const selected = presetSelect.value;
        if (selected) {
          loadPreset(selected);
        } else {
          showToast('Please select a scenario from the dropdown.');
        }
      });
    }

    // Reset Database
    if (btnResetDB) {
      btnResetDB.addEventListener('click', async () => {
        try {
          const resp = await fetch('/api/reset', { method: 'POST' });
          const data = await resp.json();
          if (data.status === 'success') {
            updateBalancesUI(data.accounts);
            showToast('Database reset: Accounts set to $1,000.00.');
          }
        } catch (err) {
          showToast('Error resetting database: ' + err.message);
        }
      });
    }

    // Add Step Row Button
    if (btnAddStepRow) {
      btnAddStepRow.addEventListener('click', addStepRow);
    }

    // Palette Account & Delta changes (updates dynamic description)
    if (paletteAccount) {
      paletteAccount.addEventListener('change', updatePalettePreview);
    }
    if (paletteDelta) {
      paletteDelta.addEventListener('change', updatePalettePreview);
    }
  }

  // ==========================================================================
  // Vertical Schedule Matrix Rendering (Rewritten from Scratch)
  // ==========================================================================

  function renderVerticalSchedule() {
    if (!verticalScheduleMatrix) return;
    verticalScheduleMatrix.innerHTML = '';
    const txNames = ['T1', 'T2', 'T3', 'T4'].slice(0, STATE.txCount);

    const txBadges = {
      T1: 'border-sky-500/40 bg-sky-500/10 text-sky-400',
      T2: 'border-purple-500/40 bg-purple-500/10 text-purple-400',
      T3: 'border-amber-500/40 bg-amber-500/10 text-amber-400',
      T4: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400',
    };

    // 1. Column Header Row (Sticky)
    const headerRow = document.createElement('div');
    headerRow.className = `grid schedule-grid-${STATE.txCount} gap-2.5 items-center pb-2 border-b border-slate-800 sticky top-0 bg-slate-900/95 z-20 backdrop-blur-md`;
    headerRow.style.gridTemplateColumns = `56px repeat(${STATE.txCount}, minmax(0, 1fr))`;

    headerRow.innerHTML = `
      <div class="text-center font-mono text-[11px] font-extrabold text-slate-500 tracking-wider">STEP</div>
    `;

    txNames.forEach(txId => {
      const colHeader = document.createElement('div');
      colHeader.className = 'flex items-center justify-between px-3 py-1.5 rounded-xl bg-slate-950/80 border border-slate-800 shadow-sm';
      colHeader.innerHTML = `
        <span class="px-2.5 py-0.5 rounded-lg text-xs font-mono font-bold border ${txBadges[txId]}">${txId}</span>
        <span class="text-[11px] font-mono text-slate-500 tx-state-tag">Idle</span>
      `;
      headerRow.appendChild(colHeader);
    });
    verticalScheduleMatrix.appendChild(headerRow);

    // 2. Vertical Step Rows
    for (let s = 1; s <= STATE.maxSteps; s++) {
      const row = createStepRowElement(s, txNames);
      verticalScheduleMatrix.appendChild(row);
    }

    if (stepRowsCountHint) {
      stepRowsCountHint.textContent = `${STATE.maxSteps} Step Rows active`;
    }
  }

  function createStepRowElement(stepNum, txNames) {
    const row = document.createElement('div');
    row.className = `grid schedule-grid-${txNames.length} gap-2.5 items-center`;
    row.style.gridTemplateColumns = `56px repeat(${txNames.length}, minmax(0, 1fr))`;
    row.dataset.stepRow = stepNum;

    // Step Indicator Label
    const stepLabel = document.createElement('div');
    stepLabel.className = 'w-14 h-16 flex items-center justify-center font-mono text-xs font-bold text-slate-400 bg-slate-950/80 rounded-xl border border-slate-800/80 select-none shadow-sm';
    stepLabel.innerHTML = `<span>S${stepNum}</span>`;
    row.appendChild(stepLabel);

    // Drop Slot for each Transaction
    txNames.forEach(txId => {
      const slot = document.createElement('div');
      slot.className = 'timeline-slot relative flex-1 min-h-[64px] h-16 rounded-xl border-2 border-dashed border-slate-800 bg-slate-950/60 hover:border-sky-500/50 hover:bg-slate-900/60 flex items-center justify-center transition-all duration-200';
      slot.dataset.tx = txId;
      slot.dataset.step = stepNum;
      window.DragDropModule.bindSlotEvents(slot);
      row.appendChild(slot);
    });

    return row;
  }

  function addStepRow() {
    STATE.maxSteps++;
    const txNames = ['T1', 'T2', 'T3', 'T4'].slice(0, STATE.txCount);
    const newRow = createStepRowElement(STATE.maxSteps, txNames);
    verticalScheduleMatrix.appendChild(newRow);

    if (stepRowsCountHint) {
      stepRowsCountHint.textContent = `${STATE.maxSteps} Step Rows active`;
    }

    if (verticalScheduleWrapper) {
      verticalScheduleWrapper.scrollTo({ top: verticalScheduleWrapper.scrollHeight, behavior: 'smooth' });
    }
  }

  function clearAllSlots() {
    document.querySelectorAll('.timeline-slot').forEach(s => s.innerHTML = '');
    updateGlobalSequenceUI();
  }

  function handleScheduleModified() {
    updateGlobalSequenceUI();
    resetToSimulateState();
  }

  function updateGlobalSequenceUI() {
    if (!sequenceStream) return;
    const schedule = extractScheduleFromDOM();
    if (sequenceCount) {
      sequenceCount.textContent = `${schedule.length} operation${schedule.length === 1 ? '' : 's'}`;
    }

    if (schedule.length === 0) {
      sequenceStream.innerHTML = '<span class="text-xs text-slate-500 font-mono">No operations placed — drag blocks into vertical schedule above</span>';
      return;
    }

    sequenceStream.innerHTML = '';
    schedule.forEach((s, idx) => {
      const pill = document.createElement('div');
      let pillColors = 'bg-sky-500/15 text-sky-300 border-sky-500/40';
      if (s.op === 'WRITE') pillColors = 'bg-purple-500/15 text-purple-300 border-purple-500/40';
      else if (s.op === 'COMMIT') pillColors = 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40';
      else if (s.op === 'ROLLBACK') pillColors = 'bg-rose-500/15 text-rose-300 border-rose-500/40';

      pill.className = `seq-pill inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-mono font-semibold border ${pillColors}`;

      let label = `${s.txId}.${s.op}`;
      if (s.op === 'READ') {
        label += `(${s.account})`;
      } else if (s.op === 'WRITE') {
        const sign = s.amount >= 0 ? '+' : '';
        label += `(${s.account}, ${sign}$${s.amount})`;
      }

      pill.innerHTML = `<span class="opacity-75">S${s.stepIndex}:</span> ${label}`;
      sequenceStream.appendChild(pill);

      if (idx < schedule.length - 1) {
        const arrow = document.createElement('span');
        arrow.className = 'text-slate-600 text-xs font-bold';
        arrow.textContent = '→';
        sequenceStream.appendChild(arrow);
      }
    });
  }

  // ==========================================================================
  // State Transitions (Simulate <-> Fix)
  // ==========================================================================

  function resetToSimulateState() {
    STATE.mode = 'SIMULATE';
    if (btnMainAction) {
      btnMainAction.className = 'btn-primary-action inline-flex items-center gap-2 px-5 py-2 rounded-xl font-semibold text-xs sm:text-sm text-white bg-sky-500 hover:bg-sky-400 shadow-lg shadow-sky-500/25 transition-all';
    }
    if (actionButtonText) actionButtonText.textContent = 'Simulate Schedule';
    if (actionIcon) {
      actionIcon.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polygon points="5 3 19 12 5 21 5 3"></polygon>
        </svg>
      `;
    }
    if (statusDot) statusDot.className = 'w-2.5 h-2.5 rounded-full bg-slate-500';
    if (serializableBadge) {
      serializableBadge.className = 'badge-status text-[11px] font-mono px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700';
      serializableBadge.textContent = 'Ready';
    }
  }

  function transformToFixState() {
    STATE.mode = 'FIX';
    if (btnMainAction) {
      btnMainAction.className = 'btn-primary-action inline-flex items-center gap-2 px-5 py-2 rounded-xl font-semibold text-xs sm:text-sm text-white bg-amber-500 hover:bg-amber-400 shadow-lg shadow-amber-500/30 transition-all animate-pulse';
    }
    if (actionButtonText) actionButtonText.textContent = 'Fix Problem (Apply Strict 2PL)';
    if (actionIcon) {
      actionIcon.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
        </svg>
      `;
    }
    if (statusDot) statusDot.className = 'w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping';
    if (serializableBadge) {
      serializableBadge.className = 'badge-status text-[11px] font-mono px-2.5 py-0.5 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/40';
      serializableBadge.textContent = 'Non-Serializable Hazard';
    }
  }

  // ==========================================================================
  // Simulation & Fixing Logic
  // ==========================================================================

  async function handleMainActionClick() {
    const schedule = extractScheduleFromDOM();
    if (schedule.length === 0) {
      showToast('Please place at least one operation block in the timeline.');
      return;
    }

    setButtonLoading(true);

    if (STATE.mode === 'SIMULATE') {
      await runSimulation(schedule);
    } else {
      await runSafeExecution(schedule);
    }

    setButtonLoading(false);
  }

  function extractScheduleFromDOM() {
    const blocks = [];
    document.querySelectorAll('.placed-block').forEach(b => {
      blocks.push({
        id: `${b.dataset.tx}_s${b.dataset.step}_${b.dataset.op}`,
        txId: b.dataset.tx,
        stepIndex: parseInt(b.dataset.step, 10),
        op: b.dataset.op,
        account: b.dataset.account,
        amount: parseFloat(b.dataset.amount) || 0,
      });
    });

    blocks.sort((a, b) => a.stepIndex - b.stepIndex);
    return blocks;
  }

  async function runSimulation(schedule) {
    try {
      const payload = {
        txCount: STATE.txCount,
        schedule: schedule,
        controlMode: 'NONE',
        isolation: 'READ COMMITTED',
      };

      const resp = await fetch('/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || 'Simulation failed');
      }

      const result = await resp.json();
      STATE.lastResult = result;

      renderAnalysisResults(result.analysis);
      renderPrecedenceGraph(result.analysis.precedenceEdges, result.analysis.cycleNodes);
      renderExecutionLogs(result.executionLogs);
      updateBalancesUI(result.finalAccounts);

      if (result.analysis.hasHazards || result.analysis.cycleDetected) {
        transformToFixState();
        showToast('Serialization hazards detected! Click "Fix Problem" to apply Strict 2PL.');
      } else {
        resetToSimulateState();
        if (statusDot) statusDot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-500';
        if (serializableBadge) {
          serializableBadge.className = 'badge-status text-[11px] font-mono px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40';
          serializableBadge.textContent = 'Conflict Serializable (Safe)';
        }
        showToast('Schedule is conflict serializable and anomaly-free.');
      }
    } catch (err) {
      showToast('Error running simulation: ' + err.message);
    }
  }

  async function runSafeExecution(schedule) {
    try {
      const payload = {
        txCount: STATE.txCount,
        schedule: schedule,
        controlMode: 'STRICT_2PL',
        isolation: 'SERIALIZABLE',
      };

      const resp = await fetch('/execute-safe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || 'Safe execution failed');
      }

      const res = await resp.json();
      const result = res.simulation || res;
      STATE.lastResult = result;

      if (result.analysis) {
        renderAnalysisResults(result.analysis);
        renderPrecedenceGraph(result.analysis.precedenceEdges, result.analysis.cycleNodes);
      }
      if (result.executionLogs) {
        renderExecutionLogs(result.executionLogs);
      }
      if (result.finalAccounts) {
        updateBalancesUI(result.finalAccounts);
      }

      resetToSimulateState();
      if (statusDot) statusDot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-500';
      if (serializableBadge) {
        serializableBadge.className = 'badge-status text-[11px] font-mono px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40';
        serializableBadge.textContent = 'Strict 2PL Enforced (Safe)';
      }
      showToast('Strict 2PL Concurrency Control applied. All hazards resolved!');
    } catch (err) {
      showToast('Error applying Strict 2PL: ' + err.message);
    }
  }

  function setButtonLoading(isLoading) {
    if (!btnMainAction) return;
    btnMainAction.disabled = isLoading;
    if (actionSpinner) actionSpinner.classList.toggle('hidden', !isLoading);
    if (actionIcon) actionIcon.classList.toggle('hidden', isLoading);
  }

  // ==========================================================================
  // Results Rendering
  // ==========================================================================

  function renderAnalysisResults(analysis) {
    if (!hazardsContent) return;
    hazardsContent.innerHTML = '';

    if (!analysis.hasHazards && !analysis.cycleDetected) {
      hazardsContent.innerHTML = `
        <div class="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 flex flex-col gap-1">
          <strong class="font-bold flex items-center gap-1.5 text-xs text-emerald-400">
            <span>✓</span> No Serialization Hazards Detected
          </strong>
          <p class="text-[11px] text-slate-300">The schedule is equivalent to a serial execution. Precedence graph is acyclic.</p>
        </div>
      `;
      return;
    }

    // Hazards list
    analysis.hazards.forEach(h => {
      const item = document.createElement('div');
      item.className = 'p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200 flex flex-col gap-1';
      item.innerHTML = `
        <div class="flex items-center justify-between">
          <strong class="text-xs font-bold text-rose-400">${escapeHtml(h.title)}</strong>
          <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30">${escapeHtml(h.type)}</span>
        </div>
        <p class="text-[11px] text-slate-300">${escapeHtml(h.description)}</p>
        <div class="text-[10px] text-slate-400 mt-1 font-mono">
          <strong class="text-amber-400">Fix Protocol:</strong> ${escapeHtml(h.fixHint)}
        </div>
      `;
      hazardsContent.appendChild(item);
    });

    if (analysis.cycleDetected) {
      const cycleItem = document.createElement('div');
      cycleItem.className = 'p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 flex flex-col gap-1';
      cycleItem.innerHTML = `
        <strong class="text-xs font-bold text-amber-400">Serialization Dependency Cycle (Deadlock)</strong>
        <p class="text-[11px] text-slate-300">Cycle path detected: <span class="font-mono text-amber-300 font-bold">${analysis.cycleNodes.join(' → ')}</span>.</p>
      `;
      hazardsContent.appendChild(cycleItem);
    }
  }

  function renderPrecedenceGraph(edges, cycleNodes) {
    if (!precedenceSvg) return;
    precedenceSvg.innerHTML = '';

    const txPositions = {
      T1: { x: 90, y: 60 },
      T2: { x: 360, y: 60 },
      T3: { x: 360, y: 170 },
      T4: { x: 90, y: 170 },
    };

    // Draw active nodes
    const activeTxs = ['T1', 'T2', 'T3', 'T4'].slice(0, STATE.txCount);
    activeTxs.forEach(tx => {
      const pos = txPositions[tx];
      const isCycle = cycleNodes && cycleNodes.includes(tx);

      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', pos.x);
      circle.setAttribute('cy', pos.y);
      circle.setAttribute('r', '22');
      circle.setAttribute('fill', isCycle ? 'rgba(244, 63, 94, 0.25)' : 'rgba(30, 41, 59, 0.8)');
      circle.setAttribute('stroke', isCycle ? '#f43f5e' : '#38bdf8');
      circle.setAttribute('stroke-width', '2');
      precedenceSvg.appendChild(circle);

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', pos.x);
      text.setAttribute('y', pos.y + 5);
      text.setAttribute('font-family', 'JetBrains Mono');
      text.setAttribute('font-size', '13');
      text.setAttribute('font-weight', 'bold');
      text.setAttribute('fill', '#f8fafc');
      text.setAttribute('text-anchor', 'middle');
      text.textContent = tx;
      precedenceSvg.appendChild(text);
    });

    // Draw directed edges
    edges.forEach(edge => {
      const from = txPositions[edge.fromTx];
      const to = txPositions[edge.toTx];
      if (!from || !to) return;

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      path.setAttribute('x1', from.x);
      path.setAttribute('y1', from.y);
      path.setAttribute('x2', to.x);
      path.setAttribute('y2', to.y);
      path.setAttribute('stroke', '#a855f7');
      path.setAttribute('stroke-width', '2');
      path.setAttribute('stroke-dasharray', '4 2');
      precedenceSvg.appendChild(path);

      const midX = (from.x + to.x) / 2;
      const midY = (from.y + to.y) / 2 - 8;
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', midX);
      label.setAttribute('y', midY);
      label.setAttribute('font-family', 'Plus Jakarta Sans');
      label.setAttribute('font-size', '10');
      label.setAttribute('fill', '#94a3b8');
      label.setAttribute('text-anchor', 'middle');
      label.textContent = `${edge.account} (${edge.conflictOp})`;
      precedenceSvg.appendChild(label);
    });

    if (edges.length === 0) {
      const emptyText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      emptyText.setAttribute('x', '225');
      emptyText.setAttribute('y', '110');
      emptyText.setAttribute('font-family', 'Plus Jakarta Sans');
      emptyText.setAttribute('font-size', '12');
      emptyText.setAttribute('fill', '#64748b');
      emptyText.setAttribute('text-anchor', 'middle');
      emptyText.textContent = 'No conflict dependencies in schedule';
      precedenceSvg.appendChild(emptyText);
    }
  }

  function renderExecutionLogs(logs) {
    if (!traceLogContainer) return;
    traceLogContainer.innerHTML = '';

    if (!logs || logs.length === 0) {
      traceLogContainer.innerHTML = '<div class="text-slate-500 italic">No operations recorded.</div>';
      return;
    }

    logs.forEach(l => {
      const row = document.createElement('div');
      row.className = 'p-2 rounded-lg bg-slate-900 border border-slate-800 text-[11px] font-mono flex items-center justify-between gap-2';

      let statusColor = 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30';
      if (l.status.includes('DEADLOCK') || l.status.includes('ROLLBACK')) {
        statusColor = 'text-rose-400 bg-rose-500/10 border-rose-500/30';
      } else if (l.status.includes('WAIT')) {
        statusColor = 'text-amber-400 bg-amber-500/10 border-amber-500/30';
      }

      row.innerHTML = `
        <div class="flex items-center gap-1.5 min-w-0">
          <span class="text-sky-400 font-bold">S${l.stepIndex}</span>
          <span class="text-slate-400">${l.txId}.${l.op}</span>
          <span class="text-slate-300 truncate">${escapeHtml(l.detail)}</span>
        </div>
        <div class="flex items-center gap-1.5 flex-shrink-0">
          <span class="px-1.5 py-0.5 rounded text-[10px] border ${statusColor}">${l.status}</span>
          <span class="text-[10px] text-slate-500">${l.durationMs}ms</span>
        </div>
      `;
      traceLogContainer.appendChild(row);
    });
  }

  // ==========================================================================
  // Presets & Scenarios
  // ==========================================================================

  function loadPreset(scenarioKey) {
    clearAllSlots();
    resetToSimulateState();
    if (presetSelect) presetSelect.value = scenarioKey;

    switch (scenarioKey) {
      case 'tx1_atomic_transfer':
        setTxCount(1);
        setBlock('T1', 1, 'READ', 'A');
        setBlock('T1', 2, 'WRITE', 'A', -200);
        setBlock('T1', 3, 'READ', 'B');
        setBlock('T1', 4, 'WRITE', 'B', 200);
        setBlock('T1', 5, 'COMMIT', 'ALL');
        showToast('Loaded 1 Tx: Atomic Bank Transfer ($200 from A to B with COMMIT).');
        break;

      case 'tx1_aborted_rollback':
        setTxCount(1);
        setBlock('T1', 1, 'READ', 'A');
        setBlock('T1', 2, 'WRITE', 'A', -500);
        setBlock('T1', 3, 'ROLLBACK', 'ALL');
        showToast('Loaded 1 Tx: Aborted Overdraft Rollback.');
        break;

      case 'lost_update':
        setTxCount(2);
        setBlock('T1', 1, 'READ', 'A');
        setBlock('T2', 2, 'READ', 'A');
        setBlock('T1', 3, 'WRITE', 'A', 200);
        setBlock('T2', 4, 'WRITE', 'A', -200);
        setBlock('T1', 5, 'COMMIT', 'ALL');
        setBlock('T2', 6, 'COMMIT', 'ALL');
        showToast('Loaded 2 Tx: Lost Update scenario.');
        break;

      case 'dirty_read':
        setTxCount(2);
        setBlock('T1', 1, 'WRITE', 'A', 500);
        setBlock('T2', 2, 'READ', 'A');
        setBlock('T1', 3, 'ROLLBACK', 'ALL');
        setBlock('T2', 4, 'COMMIT', 'ALL');
        showToast('Loaded 2 Tx: Dirty Read scenario.');
        break;

      case 'non_repeatable_read':
        setTxCount(2);
        setBlock('T1', 1, 'READ', 'A');
        setBlock('T2', 2, 'WRITE', 'A', 300);
        setBlock('T2', 3, 'COMMIT', 'ALL');
        setBlock('T1', 4, 'READ', 'A');
        setBlock('T1', 5, 'COMMIT', 'ALL');
        showToast('Loaded 2 Tx: Non-Repeatable Read scenario.');
        break;

      case 'write_skew':
        setTxCount(2);
        setBlock('T1', 1, 'READ', 'A');
        setBlock('T2', 2, 'READ', 'B');
        setBlock('T1', 3, 'WRITE', 'B', -300);
        setBlock('T2', 4, 'WRITE', 'A', -300);
        setBlock('T1', 5, 'COMMIT', 'ALL');
        setBlock('T2', 6, 'COMMIT', 'ALL');
        showToast('Loaded 2 Tx: Write Skew scenario.');
        break;

      case 'deadlock_cycle':
        setTxCount(2);
        setBlock('T1', 1, 'WRITE', 'A', 200);
        setBlock('T2', 2, 'WRITE', 'B', 200);
        setBlock('T1', 3, 'WRITE', 'B', 200);
        setBlock('T2', 4, 'WRITE', 'A', 200);
        setBlock('T1', 5, 'COMMIT', 'ALL');
        setBlock('T2', 6, 'COMMIT', 'ALL');
        showToast('Loaded 2 Tx: Serialization Cycle / 2-Way Deadlock.');
        break;

      case 'serial_safe':
        setTxCount(2);
        setBlock('T1', 1, 'READ', 'A');
        setBlock('T1', 2, 'WRITE', 'A', 150);
        setBlock('T1', 3, 'COMMIT', 'ALL');
        setBlock('T2', 4, 'READ', 'A');
        setBlock('T2', 5, 'WRITE', 'A', -150);
        setBlock('T2', 6, 'COMMIT', 'ALL');
        showToast('Loaded 2 Tx: Safe Serial Schedule.');
        break;

      case 'tx3_circular_deadlock':
        setTxCount(3);
        setBlock('T1', 1, 'WRITE', 'A', 100);
        setBlock('T2', 2, 'WRITE', 'B', 100);
        setBlock('T3', 3, 'WRITE', 'C', 100);
        setBlock('T1', 4, 'WRITE', 'B', 100);
        setBlock('T2', 5, 'WRITE', 'C', 100);
        setBlock('T3', 6, 'WRITE', 'A', 100);
        setBlock('T1', 7, 'COMMIT', 'ALL');
        setBlock('T2', 8, 'COMMIT', 'ALL');
        showToast('Loaded 3 Tx: 3-Way Circular Deadlock.');
        break;

      case 'tx3_dirty_cascade':
        setTxCount(3);
        setBlock('T1', 1, 'WRITE', 'A', 300);
        setBlock('T2', 2, 'READ', 'A');
        setBlock('T2', 3, 'WRITE', 'B', 200);
        setBlock('T3', 4, 'READ', 'B');
        setBlock('T1', 5, 'ROLLBACK', 'ALL');
        setBlock('T2', 6, 'COMMIT', 'ALL');
        setBlock('T3', 7, 'COMMIT', 'ALL');
        showToast('Loaded 3 Tx: Cascading Dirty Read & Inconsistent Analysis.');
        break;

      case 'tx3_safe_pipeline':
        setTxCount(3);
        setBlock('T1', 1, 'READ', 'A');
        setBlock('T1', 2, 'WRITE', 'A', -150);
        setBlock('T1', 3, 'COMMIT', 'ALL');
        setBlock('T2', 4, 'READ', 'A');
        setBlock('T2', 5, 'WRITE', 'B', 150);
        setBlock('T2', 6, 'COMMIT', 'ALL');
        setBlock('T3', 7, 'READ', 'B');
        setBlock('T3', 8, 'COMMIT', 'ALL');
        showToast('Loaded 3 Tx: Serialized Pipeline.');
        break;

      case 'tx4_ring_deadlock':
        setTxCount(4);
        setBlock('T1', 1, 'WRITE', 'A', 100);
        setBlock('T2', 2, 'WRITE', 'B', 100);
        setBlock('T3', 3, 'WRITE', 'C', 100);
        setBlock('T4', 4, 'WRITE', 'A', 100);
        setBlock('T1', 5, 'WRITE', 'B', 100);
        setBlock('T2', 6, 'WRITE', 'C', 100);
        setBlock('T3', 7, 'WRITE', 'A', 100);
        setBlock('T4', 8, 'COMMIT', 'ALL');
        showToast('Loaded 4 Tx: 4-Way Distributed Deadlock Ring.');
        break;

      case 'tx4_multi_hazard':
        setTxCount(4);
        setBlock('T1', 1, 'READ', 'A');
        setBlock('T2', 2, 'READ', 'A');
        setBlock('T1', 3, 'WRITE', 'A', 200);
        setBlock('T2', 4, 'WRITE', 'A', -200);
        setBlock('T3', 5, 'WRITE', 'B', 400);
        setBlock('T4', 6, 'READ', 'B');
        setBlock('T3', 7, 'ROLLBACK', 'ALL');
        setBlock('T4', 8, 'COMMIT', 'ALL');
        showToast('Loaded 4 Tx: Multi-Hazard Storm.');
        break;

      case 'tx4_safe_settlement':
        setTxCount(4);
        setBlock('T1', 1, 'WRITE', 'A', 100);
        setBlock('T1', 2, 'COMMIT', 'ALL');
        setBlock('T2', 3, 'WRITE', 'B', -100);
        setBlock('T2', 4, 'COMMIT', 'ALL');
        setBlock('T3', 5, 'WRITE', 'C', 200);
        setBlock('T3', 6, 'COMMIT', 'ALL');
        setBlock('T4', 7, 'READ', 'A');
        setBlock('T4', 8, 'COMMIT', 'ALL');
        showToast('Loaded 4 Tx: Concurrent Batch Settlement.');
        break;
    }
  }

  function setTxCount(count) {
    STATE.txCount = count;
    if (txCountSelect) txCountSelect.value = count;
    txCountButtons.forEach(b => {
      b.classList.toggle('active', parseInt(b.getAttribute('data-count'), 10) === count);
    });
    renderVerticalSchedule();
    updateGlobalSequenceUI();
  }

  function setBlock(tx, step, op, account, amount = 0) {
    if (step > STATE.maxSteps) {
      while (STATE.maxSteps < step) {
        addStepRow();
      }
    }
    const slot = document.querySelector(`.timeline-slot[data-tx="${tx}"][data-step="${step}"]`);
    if (slot) {
      window.DragDropModule.placeBlockInSlot(slot, {
        txId: tx,
        stepIndex: step,
        op: op,
        account: account,
        amount: amount,
      });
      updateGlobalSequenceUI();
    }
  }

  // ==========================================================================
  // Accounts Balance UI & Palette Live Amount Preview
  // ==========================================================================

  async function fetchAccountBalances() {
    try {
      const resp = await fetch('/api/accounts');
      if (resp.ok) {
        const accounts = await resp.json();
        updateBalancesUI(accounts);
      }
    } catch (err) {
      console.warn('Could not fetch accounts:', err);
    }
  }

  function updatePalettePreview() {
    const acc = paletteAccount ? paletteAccount.value : 'A';
    const delta = paletteDelta ? parseFloat(paletteDelta.value) : 200;
    const currentBal = STATE.accounts[acc] !== undefined ? STATE.accounts[acc] : 1000;
    const sign = delta >= 0 ? '+' : '';
    const newBal = currentBal + delta;

    if (paletteReadAccountBadge) {
      paletteReadAccountBadge.textContent = `(Account ${acc})`;
    }
    if (paletteReadDesc) {
      paletteReadDesc.textContent = `SELECT balance (Current: $${currentBal.toFixed(2)})`;
    }
    if (paletteWriteAmountBadge) {
      paletteWriteAmountBadge.textContent = `(${sign}$${Math.abs(delta).toFixed(2)})`;
    }
    if (paletteWriteDesc) {
      paletteWriteDesc.textContent = `UPDATE balance by ${sign}$${Math.abs(delta).toFixed(2)} (New: $${newBal.toFixed(2)})`;
    }
  }

  function updateBalancesUI(accounts) {
    if (!accounts) return;
    accounts.forEach(a => {
      STATE.accounts[a.accountCode] = a.balance;
      if (a.accountCode === 'A' && balA) balA.textContent = `$${a.balance.toFixed(2)}`;
      if (a.accountCode === 'B' && balB) balB.textContent = `$${a.balance.toFixed(2)}`;
      if (a.accountCode === 'C' && balC) balC.textContent = `$${a.balance.toFixed(2)}`;
    });

    // Update account select options with proper live amounts in the DB
    if (paletteAccount) {
      const curSelected = paletteAccount.value;
      paletteAccount.innerHTML = `
        <option value="A" ${curSelected === 'A' ? 'selected' : ''}>Account A ($${(STATE.accounts['A'] || 1000).toFixed(2)})</option>
        <option value="B" ${curSelected === 'B' ? 'selected' : ''}>Account B ($${(STATE.accounts['B'] || 1000).toFixed(2)})</option>
        <option value="C" ${curSelected === 'C' ? 'selected' : ''}>Account C ($${(STATE.accounts['C'] || 1000).toFixed(2)})</option>
      `;
    }

    updatePalettePreview();
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  function showToast(message) {
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toastMessage');
    if (!toast || !toastMessage) return;
    toastMessage.textContent = message;
    toast.classList.remove('translate-y-20', 'opacity-0');
    toast.classList.add('translate-y-0', 'opacity-100');
    setTimeout(() => {
      toast.classList.remove('translate-y-0', 'opacity-100');
      toast.classList.add('translate-y-20', 'opacity-0');
    }, 3500);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, m => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    }[m]));
  }

  // Run on startup
  window.addEventListener('DOMContentLoaded', init);
})();

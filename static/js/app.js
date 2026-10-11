/**
 * app.js - Main Application Controller for goBankV2
 *
 * Responsibilities (Section 4.3):
 * - State management: txCount, stepRows, palette, schedule, balances, mode, lastResult, dirty
 * - Pure rendering: state in -> DOM out
 * - Strict canPlace matrix validation: 1 op per step row, no op after terminal op
 * - Precedence graph rendering with curved arrows, edge types (RW/WR/WW), cycle animations
 * - Live MySQL trace playback with staggered line animation & skip option
 * - Flash animations on account balance card increases/decreases
 * - 12 Canonical Presets aligned with analyzer tests
 * - Dynamic Simulate / Fix button state machine
 */

(function () {
  'use strict';

  // ==========================================================================
  // 1. STATE (Section 4.3)
  // ==========================================================================
  const STATE = {
    txCount: 2,
    stepRows: 8,
    palette: {
      account: 'A',
      delta: 200,
    },
    schedule: [], // Array of { id, step, tx, type, account, delta }
    balances: { A: 1000, B: 1000, C: 1000 },
    mode: 'SIMULATE', // 'SIMULATE' | 'FIX' | 'BUSY'
    lastResult: null,
    dirty: false,
    isolation: 'READ UNCOMMITTED',
  };

  // Trace playback controller state
  let tracePlaybackTimers = [];
  let currentTraceLogs = [];

  // ==========================================================================
  // DOM Elements
  // ==========================================================================
  const txCountButtons = document.querySelectorAll('.tx-btn');
  const txCountSelect = document.getElementById('txCountSelect');
  const isolationSelect = document.getElementById('isolationSelect');
  const presetSelect = document.getElementById('presetScenarioSelect');
  const btnLoadPreset = document.getElementById('btnLoadPreset');
  const btnClearTimeline = document.getElementById('btnClearTimeline');
  const btnResetDB = document.getElementById('btnResetDB');
  const btnMainAction = document.getElementById('btnMainAction');
  const actionButtonText = document.getElementById('actionButtonText');
  const actionIcon = document.getElementById('actionIcon');
  const actionSpinner = document.getElementById('actionSpinner');

  const verticalScheduleMatrix = document.getElementById('verticalScheduleMatrix');
  const verticalScheduleWrapper = document.getElementById('verticalScheduleWrapper');
  const btnAddStepRow = document.getElementById('btnAddStepRow');
  const stepRowsCountHint = document.getElementById('stepRowsCountHint');

  const sequenceStream = document.getElementById('sequenceStream');
  const sequenceCount = document.getElementById('sequenceCount');

  const paletteAccount = document.getElementById('paletteAccount');
  const paletteDelta = document.getElementById('paletteDelta');
  const paletteReadAccountBadge = document.getElementById('paletteReadAccountBadge');
  const paletteReadDesc = document.getElementById('paletteReadDesc');
  const paletteWriteAmountBadge = document.getElementById('paletteWriteAmountBadge');
  const paletteWriteDesc = document.getElementById('paletteWriteDesc');

  const cardAccountA = document.getElementById('cardAccountA');
  const cardAccountB = document.getElementById('cardAccountB');
  const cardAccountC = document.getElementById('cardAccountC');
  const balAccountA = document.getElementById('balAccountA');
  const balAccountB = document.getElementById('balAccountB');
  const balAccountC = document.getElementById('balAccountC');

  const hazardsContent = document.getElementById('hazardsContent');
  const serializableBadge = document.getElementById('serializableBadge');
  const statusDot = document.getElementById('statusDot');
  const precedenceSvg = document.getElementById('precedenceSvg');
  const traceLogContainer = document.getElementById('traceLogContainer');
  const btnSkipTrace = document.getElementById('btnSkipTrace');

  // ==========================================================================
  // 2. API CONTRACTS (Section 3.1)
  // ==========================================================================
  const API = {
    async getAccounts() {
      const resp = await fetch('/api/accounts');
      if (!resp.ok) throw new Error('Failed to fetch accounts');
      return await resp.json();
    },

    async resetDatabase() {
      const resp = await fetch('/api/reset', { method: 'POST' });
      if (!resp.ok) throw new Error('Failed to reset database');
      return await resp.json();
    },

    async simulate(payload) {
      // Supports /api/simulate with fallback to /simulate
      let resp = await fetch('/api/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (resp.status === 404) {
        resp = await fetch('/simulate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Simulation failed' }));
        throw new Error(err.error || 'Simulation failed');
      }
      return await resp.json();
    },

    async executeSafe(payload) {
      // Supports /api/execute-safe with fallback to /execute-safe
      let resp = await fetch('/api/execute-safe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (resp.status === 404) {
        resp = await fetch('/execute-safe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Safe execution failed' }));
        throw new Error(err.error || 'Safe execution failed');
      }
      return await resp.json();
    },
  };

  // ==========================================================================
  // 3. MATRIX VALIDATION RULES (canPlace) (Section 0 & 4.4)
  // ==========================================================================
  function canPlace(tx, step, movingId, op) {
    // 1. Slot empty: No other op in that exact slot
    const existingInSlot = STATE.schedule.find(
      s => s.tx === tx && s.step === step && s.id !== movingId
    );
    if (existingInSlot) {
      return { allowed: false, reason: `Slot (T${tx}, S${step}) already has an operation.` };
    }

    // 2. One operation per step row across ALL columns (global temporal order)
    const existingInRow = STATE.schedule.find(
      s => s.step === step && s.id !== movingId
    );
    if (existingInRow) {
      return {
        allowed: false,
        reason: `Step row S${step} already contains ${existingInRow.tx}.${existingInRow.type}. Only 1 operation permitted per step row across all transactions.`,
      };
    }

    // 3. No operation after a terminal operation (COMMIT or ROLLBACK) for this transaction
    const terminalBefore = STATE.schedule.find(
      s => s.tx === tx && s.step < step && (s.type === 'COMMIT' || s.type === 'ROLLBACK') && s.id !== movingId
    );
    if (terminalBefore) {
      return {
        allowed: false,
        reason: `Transaction ${tx} already completed (${terminalBefore.type}) at Step S${terminalBefore.step}. No ops allowed after terminal operation.`,
      };
    }

    // 4. If placing a terminal operation, ensure no existing operations of this tx exist at later steps
    if (op === 'COMMIT' || op === 'ROLLBACK') {
      const opAfter = STATE.schedule.find(
        s => s.tx === tx && s.step > step && s.id !== movingId
      );
      if (opAfter) {
        return {
          allowed: false,
          reason: `Cannot place ${op} at Step S${step} before ${tx}'s existing operation at Step S${opAfter.step}.`,
        };
      }
    }

    return { allowed: true };
  }

  // ==========================================================================
  // 4. SCHEDULE MUTATIONS (Callbacks from dragdrop.js)
  // ==========================================================================
  function handlePlaceBlock(tx, step, op, account, delta) {
    const id = `op_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const newBlock = {
      id: id,
      step: step,
      tx: tx,
      type: op,
      account: (op === 'COMMIT' || op === 'ROLLBACK') ? 'ALL' : account,
      delta: (op === 'WRITE') ? delta : 0,
    };

    STATE.schedule.push(newBlock);
    sortSchedule();
    onScheduleChange();
  }

  function handleMoveBlock(id, targetTx, targetStep) {
    const block = STATE.schedule.find(s => s.id === id);
    if (!block) return;

    block.tx = targetTx;
    block.step = targetStep;
    sortSchedule();
    onScheduleChange();
  }

  function handleRemoveBlock(id) {
    STATE.schedule = STATE.schedule.filter(s => s.id !== id);
    onScheduleChange();
  }

  function sortSchedule() {
    STATE.schedule.sort((a, b) => a.step - b.step);
  }

  function onScheduleChange() {
    STATE.dirty = true;
    STATE.mode = 'SIMULATE';
    resetToSimulateState();
    clearAnalysisViews();
    renderMatrix();
    renderSequenceStream();
  }

  // ==========================================================================
  // 5. MATRIX RENDERING (Pure: State In -> DOM Out) (Section 4.4)
  // ==========================================================================
  function renderMatrix() {
    if (!verticalScheduleMatrix) return;
    verticalScheduleMatrix.innerHTML = '';

    const txNames = ['T1', 'T2', 'T3', 'T4'].slice(0, STATE.txCount);

    const txBadges = {
      T1: 'border-sky-500/40 bg-sky-500/10 text-sky-400',
      T2: 'border-amber-500/40 bg-amber-500/10 text-amber-400',
      T3: 'border-purple-500/40 bg-purple-500/10 text-purple-400',
      T4: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400',
    };

    // 1. Column Header Row (Sticky top-0)
    const headerRow = document.createElement('div');
    headerRow.className = `grid schedule-grid-${STATE.txCount} gap-2.5 items-center pb-2 border-b border-slate-800 sticky top-0 bg-slate-900/95 z-20 backdrop-blur-md`;
    headerRow.style.gridTemplateColumns = `56px repeat(${STATE.txCount}, minmax(0, 1fr))`;

    headerRow.innerHTML = `
      <div class="text-center font-mono text-[11px] font-extrabold text-slate-500 tracking-wider">STEP</div>
    `;

    txNames.forEach(txId => {
      const hasOps = STATE.schedule.some(s => s.tx === txId);
      const colHeader = document.createElement('div');
      colHeader.className = 'flex items-center justify-between px-3 py-1.5 rounded-xl bg-slate-950/80 border border-slate-800 shadow-sm';
      colHeader.innerHTML = `
        <span class="px-2.5 py-0.5 rounded-lg text-xs font-mono font-bold border ${txBadges[txId]}">${txId}</span>
        <span class="text-[11px] font-mono ${hasOps ? 'text-sky-400 font-semibold' : 'text-slate-500'} tx-state-tag">${hasOps ? 'Active' : 'Idle'}</span>
      `;
      headerRow.appendChild(colHeader);
    });
    verticalScheduleMatrix.appendChild(headerRow);

    // 2. Vertical Step Rows
    for (let stepNum = 1; stepNum <= STATE.stepRows; stepNum++) {
      const row = document.createElement('div');
      row.className = `grid schedule-grid-${STATE.txCount} gap-2.5 items-center`;
      row.style.gridTemplateColumns = `56px repeat(${STATE.txCount}, minmax(0, 1fr))`;
      row.dataset.stepRow = stepNum;

      // Step indicator label
      const stepLabel = document.createElement('div');
      stepLabel.className = 'w-14 h-16 flex items-center justify-center font-mono text-xs font-bold text-slate-400 bg-slate-950/80 rounded-xl border border-slate-800/80 select-none shadow-sm';
      stepLabel.innerHTML = `<span>S${stepNum}</span>`;
      row.appendChild(stepLabel);

      // Drop slots for each active transaction
      txNames.forEach(txId => {
        const slot = document.createElement('div');
        slot.className = 'timeline-slot relative flex-1 min-h-[64px] h-16 rounded-xl border-2 border-dashed border-slate-800 bg-slate-950/60 hover:border-sky-500/50 hover:bg-slate-900/60 flex items-center justify-center transition-all duration-200';
        slot.dataset.tx = txId;
        slot.dataset.step = stepNum;

        // Check if there is an operation placed in this slot
        const blockData = STATE.schedule.find(s => s.tx === txId && s.step === stepNum);
        if (blockData) {
          const blockEl = createPlacedBlockElement(blockData);
          slot.appendChild(blockEl);
        }

        window.DragDropModule.bindSlot(slot);
        row.appendChild(slot);
      });

      verticalScheduleMatrix.appendChild(row);
    }

    if (stepRowsCountHint) {
      stepRowsCountHint.textContent = `${STATE.stepRows} Step Rows active`;
    }
  }

  function createPlacedBlockElement(blockData) {
    const blockDiv = document.createElement('div');
    blockDiv.dataset.id = blockData.id;
    blockDiv.dataset.tx = blockData.tx;
    blockDiv.dataset.step = blockData.step;
    blockDiv.dataset.op = blockData.type;
    blockDiv.dataset.account = blockData.account;
    blockDiv.dataset.amount = blockData.delta;

    let opStyles = 'bg-sky-500/15 border-sky-500/40 text-sky-100';
    let opBadge = 'text-sky-400 bg-sky-500/20';
    let letter = 'R';
    let detailsHtml = '';

    if (blockData.type === 'READ') {
      opStyles = 'bg-sky-500/15 border-sky-500/40 text-sky-100';
      opBadge = 'text-sky-400 bg-sky-500/20';
      letter = 'R';
      detailsHtml = `
        <div class="flex items-center gap-1.5 font-mono text-xs font-bold text-sky-300">
          <span>READ(${blockData.account})</span>
        </div>
        <span class="text-[10px] font-mono text-slate-400">SELECT balance</span>
      `;
    } else if (blockData.type === 'WRITE') {
      opStyles = 'bg-amber-500/15 border-amber-500/40 text-amber-100';
      opBadge = 'text-amber-400 bg-amber-500/20';
      letter = 'W';
      const sign = blockData.delta >= 0 ? '+' : '';
      detailsHtml = `
        <div class="flex items-center justify-between gap-1 font-mono text-xs font-bold text-amber-300">
          <span>WRITE(${blockData.account})</span>
          <span class="px-1.5 py-0.5 rounded bg-amber-500/25 text-amber-200 text-[10px] font-mono">${sign}$${Math.abs(blockData.delta)}</span>
        </div>
        <span class="text-[10px] font-mono text-slate-400">UPDATE balance</span>
      `;
    } else if (blockData.type === 'COMMIT') {
      opStyles = 'bg-emerald-500/15 border-emerald-500/40 text-emerald-100';
      opBadge = 'text-emerald-400 bg-emerald-500/20';
      letter = 'C';
      detailsHtml = `
        <div class="font-mono text-xs font-bold text-emerald-300">COMMIT</div>
        <span class="text-[10px] font-mono text-emerald-400/80">Release Locks</span>
      `;
    } else if (blockData.type === 'ROLLBACK') {
      opStyles = 'bg-rose-500/15 border-rose-500/40 text-rose-100';
      opBadge = 'text-rose-400 bg-rose-500/20';
      letter = 'AB';
      detailsHtml = `
        <div class="font-mono text-xs font-bold text-rose-300">ROLLBACK</div>
        <span class="text-[10px] font-mono text-rose-400/80">Abort & Undo</span>
      `;
    }

    blockDiv.className = `placed-block relative w-full h-full p-2 rounded-xl flex items-center justify-between gap-2 cursor-grab active:cursor-grabbing select-none border transition-all duration-200 shadow-sm ${opStyles}`;
    blockDiv.innerHTML = `
      <div class="flex items-center gap-2 min-w-0">
        <div class="w-6 h-6 rounded-md ${opBadge} font-mono font-bold flex items-center justify-center text-[10px] flex-shrink-0">
          ${letter}
        </div>
        <div class="flex flex-col min-w-0 leading-tight">
          ${detailsHtml}
        </div>
      </div>
      <button type="button" class="placed-remove text-slate-400 hover:text-rose-400 font-bold text-base leading-none p-1 rounded hover:bg-slate-800/60 transition flex-shrink-0" title="Remove block">&times;</button>
    `;

    // Click to remove
    const removeBtn = blockDiv.querySelector('.placed-remove');
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleRemoveBlock(blockData.id);
    });

    // Bind dragging on placed block
    window.DragDropModule.bindPlacedBlock(blockDiv, {
      id: blockData.id,
      tx: blockData.tx,
      step: blockData.step,
      op: blockData.type,
      account: blockData.account,
      delta: blockData.delta,
    });

    return blockDiv;
  }

  function addStepRow() {
    if (STATE.stepRows >= 40) {
      showToast('Maximum step rows limit (40) reached.', 'warning');
      return;
    }
    STATE.stepRows++;
    renderMatrix();
    if (verticalScheduleWrapper) {
      verticalScheduleWrapper.scrollTo({ top: verticalScheduleWrapper.scrollHeight, behavior: 'smooth' });
    }
  }

  function setTxCount(count) {
    if (count === STATE.txCount) return;

    // Check if hidden columns have placed operations
    const hiddenOps = STATE.schedule.filter(s => {
      const txNum = parseInt(s.tx.replace('T', ''), 10);
      return txNum > count;
    });

    if (hiddenOps.length > 0) {
      showToast(`Removed ${hiddenOps.length} operation(s) from hidden transaction columns.`, 'info');
      STATE.schedule = STATE.schedule.filter(s => {
        const txNum = parseInt(s.tx.replace('T', ''), 10);
        return txNum <= count;
      });
    }

    STATE.txCount = count;
    if (txCountSelect) txCountSelect.value = count;
    txCountButtons.forEach(btn => {
      const btnCount = parseInt(btn.getAttribute('data-count'), 10);
      btn.classList.toggle('active', btnCount === count);
      if (btnCount === count) {
        btn.className = 'tx-btn active px-3 py-1 text-xs font-mono font-semibold rounded-lg bg-sky-500/20 text-sky-400 border border-sky-500/40 shadow-sm';
      } else {
        btn.className = 'tx-btn px-3 py-1 text-xs font-mono font-semibold rounded-lg text-slate-400 hover:text-slate-200 transition';
      }
    });

    onScheduleChange();
  }

  // ==========================================================================
  // 6. SEQUENCE STREAM RENDERING (Section 4.2 & 4.4)
  // ==========================================================================
  function renderSequenceStream(customOrder, labelPrefix) {
    if (!sequenceStream) return;
    const ops = customOrder || STATE.schedule;

    if (sequenceCount) {
      sequenceCount.textContent = `${ops.length} operation${ops.length === 1 ? '' : 's'}`;
    }

    if (ops.length === 0) {
      sequenceStream.innerHTML = '<span class="text-xs text-slate-500 font-mono">No operations placed — drag blocks into vertical schedule above</span>';
      return;
    }

    sequenceStream.innerHTML = '';

    if (labelPrefix) {
      const prefixSpan = document.createElement('span');
      prefixSpan.className = 'text-[11px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 mr-1 font-semibold';
      prefixSpan.textContent = labelPrefix;
      sequenceStream.appendChild(prefixSpan);
    }

    ops.forEach((s, idx) => {
      const pill = document.createElement('div');
      let pillColors = 'bg-sky-500/15 text-sky-300 border-sky-500/40';
      const opType = s.type || s.op;

      if (opType === 'WRITE') pillColors = 'bg-amber-500/15 text-amber-300 border-amber-500/40';
      else if (opType === 'COMMIT') pillColors = 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40';
      else if (opType === 'ROLLBACK') pillColors = 'bg-rose-500/15 text-rose-300 border-rose-500/40';

      pill.className = `seq-pill inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-mono font-semibold border ${pillColors}`;

      const txLabel = s.tx || s.txId;
      let label = `${txLabel}.${opType}`;
      if (opType === 'READ') {
        label += `(${s.account})`;
      } else if (opType === 'WRITE') {
        const deltaVal = s.delta !== undefined ? s.delta : (s.amount || 0);
        const sign = deltaVal >= 0 ? '+' : '';
        label += `(${s.account}, ${sign}$${Math.abs(deltaVal)})`;
      }

      const stepNum = s.step !== undefined ? s.step : s.stepIndex;
      pill.innerHTML = `<span class="opacity-75">S${stepNum}:</span> ${label}`;
      sequenceStream.appendChild(pill);

      if (idx < ops.length - 1) {
        const arrow = document.createElement('span');
        arrow.className = 'text-slate-600 text-xs font-bold';
        arrow.textContent = '→';
        sequenceStream.appendChild(arrow);
      }
    });
  }

  // ==========================================================================
  // 7. PALETTE RENDERING & DB BALANCES (Section 4.2)
  // ==========================================================================
  function updatePalettePreview() {
    const acc = paletteAccount ? paletteAccount.value : 'A';
    const delta = paletteDelta ? parseFloat(paletteDelta.value) : 200;
    STATE.palette.account = acc;
    STATE.palette.delta = delta;

    const currentBal = STATE.balances[acc] !== undefined ? STATE.balances[acc] : 1000;
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

    // Format can be array of accounts [{accountCode, balance}] or map {A: 1000, B: 1000, C: 1000}
    const newBalances = {};
    if (Array.isArray(accounts)) {
      accounts.forEach(a => {
        newBalances[a.accountCode || a.code] = parseFloat(a.balance);
      });
    } else if (typeof accounts === 'object') {
      Object.keys(accounts).forEach(k => {
        newBalances[k] = parseFloat(accounts[k]);
      });
    }

    // Compare with previous balances for green/red flash animation
    ['A', 'B', 'C'].forEach(code => {
      const oldVal = STATE.balances[code] !== undefined ? STATE.balances[code] : 1000;
      const newVal = newBalances[code] !== undefined ? newBalances[code] : oldVal;

      const balEl = code === 'A' ? balAccountA : code === 'B' ? balAccountB : balAccountC;
      const cardEl = code === 'A' ? cardAccountA : code === 'B' ? cardAccountB : cardAccountC;

      if (balEl) balEl.textContent = `$${newVal.toFixed(2)}`;

      if (cardEl && newVal !== oldVal) {
        cardEl.classList.remove('flash-increase', 'flash-decrease');
        void cardEl.offsetWidth; // Trigger reflow
        if (newVal > oldVal) {
          cardEl.classList.add('flash-increase');
        } else {
          cardEl.classList.add('flash-decrease');
        }
      }

      STATE.balances[code] = newVal;
    });

    // Update palette options
    if (paletteAccount) {
      const curSelected = paletteAccount.value;
      paletteAccount.innerHTML = `
        <option value="A" ${curSelected === 'A' ? 'selected' : ''}>Account A ($${(STATE.balances['A'] || 1000).toFixed(2)})</option>
        <option value="B" ${curSelected === 'B' ? 'selected' : ''}>Account B ($${(STATE.balances['B'] || 1000).toFixed(2)})</option>
        <option value="C" ${curSelected === 'C' ? 'selected' : ''}>Account C ($${(STATE.balances['C'] || 1000).toFixed(2)})</option>
      `;
    }

    updatePalettePreview();
  }

  // ==========================================================================
  // 8. ANALYSIS RENDERING (Hazards, Precedence Graph, Trace) (Section 4.5 & 4.6)
  // ==========================================================================
  function clearAnalysisViews() {
    if (hazardsContent) {
      hazardsContent.innerHTML = '<p class="text-slate-500 italic">Run simulation to evaluate conflict serializability and detect anomalies.</p>';
    }
    if (precedenceSvg) {
      renderPrecedenceGraph([], []);
    }
    if (traceLogContainer) {
      clearTracePlayback();
      traceLogContainer.innerHTML = '<div class="text-slate-500 italic">No execution trace recorded. Click Simulate to execute.</div>';
    }
    if (btnSkipTrace) {
      btnSkipTrace.classList.add('hidden');
    }
  }

  function renderAnalysisResults(analysis) {
    if (!hazardsContent) return;
    hazardsContent.innerHTML = '';

    const hazards = analysis.hazards || [];
    const hasCycle = analysis.cycleDetected || (analysis.cycleNodes && analysis.cycleNodes.length > 0);

    if (hazards.length === 0 && !hasCycle) {
      hazardsContent.innerHTML = `
        <div class="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 flex flex-col gap-1.5 shadow-sm">
          <strong class="font-bold flex items-center gap-1.5 text-xs text-emerald-400">
            <svg class="w-4 h-4 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M20 6L9 17l-5-5"></path>
            </svg>
            <span>Conflict Serializable (No Hazards)</span>
          </strong>
          <p class="text-[11px] text-slate-300">The schedule is equivalent to a serial execution. Precedence dependency graph $P(S)$ is acyclic.</p>
        </div>
      `;
      return;
    }

    // Hazard anomaly cards
    hazards.forEach(h => {
      const item = document.createElement('div');
      item.className = 'p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200 flex flex-col gap-1.5 shadow-sm';
      const title = h.title || h.kind || 'Hazard Anomaly';
      const type = h.type || h.kind || 'HAZARD';
      const desc = h.description || h.message || '';
      const hint = h.fixHint || h.hint || 'Use SELECT ... FOR UPDATE / strict 2PL';

      item.innerHTML = `
        <div class="flex items-center justify-between">
          <strong class="text-xs font-bold text-rose-400">${escapeHtml(title)}</strong>
          <span class="text-[10px] font-mono px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30">${escapeHtml(type)}</span>
        </div>
        <p class="text-[11px] text-slate-300 leading-relaxed">${escapeHtml(desc)}</p>
        <div class="text-[10px] text-slate-400 mt-0.5 font-mono bg-slate-950/60 p-2 rounded-lg border border-slate-800">
          <span class="text-amber-400 font-semibold">Resolution Hint:</span> ${escapeHtml(hint)}
        </div>
      `;
      hazardsContent.appendChild(item);
    });

    if (hasCycle) {
      const cycleItem = document.createElement('div');
      cycleItem.className = 'p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 flex flex-col gap-1.5 shadow-sm';
      const nodes = (analysis.cycleNodes || []).join(' → ');
      cycleItem.innerHTML = `
        <div class="flex items-center justify-between">
          <strong class="text-xs font-bold text-amber-400">Serialization Dependency Cycle (Deadlock)</strong>
          <span class="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">CYCLE</span>
        </div>
        <p class="text-[11px] text-slate-300">Circular wait-for lock cycle detected across transactions: <span class="font-mono text-amber-300 font-bold">${escapeHtml(nodes)}</span>.</p>
        <div class="text-[10px] text-slate-400 font-mono bg-slate-950/60 p-2 rounded-lg border border-slate-800">
          <span class="text-amber-400 font-semibold">Resolution Hint:</span> Acquire locks in ascending account order under Strict 2PL.
        </div>
      `;
      hazardsContent.appendChild(cycleItem);
    }
  }

  // Precedence Graph Rendering (Section 4.5)
  function renderPrecedenceGraph(edges, cycleNodes) {
    if (!precedenceSvg) return;
    precedenceSvg.innerHTML = '';

    const width = 450;
    const height = 220;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = 75;

    // SVG Defs for Arrowhead Markers
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');

    // Helper to create marker
    function createArrowMarker(id, color) {
      const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
      marker.setAttribute('id', id);
      marker.setAttribute('viewBox', '0 0 10 10');
      marker.setAttribute('refX', '7');
      marker.setAttribute('refY', '3.5');
      marker.setAttribute('markerWidth', '7');
      marker.setAttribute('markerHeight', '7');
      marker.setAttribute('orient', 'auto');
      marker.setAttribute('markerUnits', 'strokeWidth');

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M 0 0 L 8 3.5 L 0 7 z');
      path.setAttribute('fill', color);
      marker.appendChild(path);
      return marker;
    }

    defs.appendChild(createArrowMarker('arrow-rw', '#38bdf8')); // Read-Write (Blue)
    defs.appendChild(createArrowMarker('arrow-wr', '#f59e0b')); // Write-Read (Amber)
    defs.appendChild(createArrowMarker('arrow-ww', '#ec4899')); // Write-Write (Pink/Purple)
    defs.appendChild(createArrowMarker('arrow-cycle', '#ef4444')); // In Cycle (Red)
    defs.appendChild(createArrowMarker('arrow-default', '#94a3b8'));
    precedenceSvg.appendChild(defs);

    // Compute circular positions for active transactions
    const activeTxs = ['T1', 'T2', 'T3', 'T4'].slice(0, STATE.txCount);
    const txPositions = {};

    activeTxs.forEach((tx, i) => {
      // Circle layout with T1 starting at top (-PI/2)
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / activeTxs.length;
      txPositions[tx] = {
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle),
      };
    });

    const cycleNodeSet = new Set(cycleNodes || []);

    // Draw Curved Directed Edges
    (edges || []).forEach(edge => {
      const fromTx = edge.fromTx || (edge.from ? `T${edge.from}` : null);
      const toTx = edge.toTx || (edge.to ? `T${edge.to}` : null);
      if (!fromTx || !toTx || !txPositions[fromTx] || !txPositions[toTx]) return;

      const p1 = txPositions[fromTx];
      const p2 = txPositions[toTx];

      // Determine edge kind and colors
      let edgeKind = 'RW';
      if (edge.conflictOp === 'WRITE') {
        edgeKind = 'WR';
      }
      if (edge.kinds && edge.kinds.length > 0) {
        edgeKind = edge.kinds[0];
      }

      const inCycle = edge.inCycle || (cycleNodeSet.has(fromTx) && cycleNodeSet.has(toTx));

      let strokeColor = '#38bdf8'; // RW
      let markerId = 'arrow-rw';

      if (edgeKind === 'WR') {
        strokeColor = '#f59e0b';
        markerId = 'arrow-wr';
      } else if (edgeKind === 'WW') {
        strokeColor = '#ec4899';
        markerId = 'arrow-ww';
      }

      if (inCycle) {
        strokeColor = '#ef4444';
        markerId = 'arrow-cycle';
      }

      // Compute curve control point offset
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const dist = Math.hypot(dx, dy) || 1;
      const normX = -dy / dist;
      const normY = dx / dist;

      // Curve bowing outward
      const curvature = 28;
      const midX = (p1.x + p2.x) / 2 + normX * curvature;
      const midY = (p1.y + p2.y) / 2 + normY * curvature;

      // True tangent arrival at start (p1) and end (p2)
      const t1x = midX - p1.x;
      const t1y = midY - p1.y;
      const t1dist = Math.hypot(t1x, t1y) || 1;

      const t2x = p2.x - midX;
      const t2y = p2.y - midY;
      const t2dist = Math.hypot(t2x, t2y) || 1;

      // Circle radius is 20. Stop 27px from center so the arrowhead rests clearly outside the node.
      const startOffset = 22;
      const stopOffset = 27;

      const startX = p1.x + (t1x / t1dist) * startOffset;
      const startY = p1.y + (t1y / t1dist) * startOffset;
      const endX = p2.x - (t2x / t2dist) * stopOffset;
      const endY = p2.y - (t2y / t2dist) * stopOffset;

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M ${startX} ${startY} Q ${midX} ${midY} ${endX} ${endY}`);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', strokeColor);
      path.setAttribute('stroke-width', inCycle ? '2.5' : '2');
      path.setAttribute('marker-end', `url(#${markerId})`);

      if (inCycle) {
        path.classList.add('cycle-edge-anim');
      }

      precedenceSvg.appendChild(path);

      // Edge Conflict Label
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', midX);
      label.setAttribute('y', midY - 4);
      label.setAttribute('font-family', 'JetBrains Mono');
      label.setAttribute('font-size', '9');
      label.setAttribute('font-weight', 'bold');
      label.setAttribute('fill', strokeColor);
      label.setAttribute('text-anchor', 'middle');
      const acc = edge.account || '';
      label.textContent = acc ? `${acc}:${edgeKind}` : edgeKind;
      precedenceSvg.appendChild(label);
    });

    // Draw Transaction Nodes
    activeTxs.forEach(tx => {
      const pos = txPositions[tx];
      const isCycle = cycleNodeSet.has(tx);

      // Node circle
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', pos.x);
      circle.setAttribute('cy', pos.y);
      circle.setAttribute('r', '20');
      circle.setAttribute('fill', isCycle ? 'rgba(244, 63, 94, 0.25)' : 'rgba(15, 23, 42, 0.9)');
      circle.setAttribute('stroke', isCycle ? '#f43f5e' : '#38bdf8');
      circle.setAttribute('stroke-width', isCycle ? '2.5' : '2');
      precedenceSvg.appendChild(circle);

      // Node text
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', pos.x);
      text.setAttribute('y', pos.y + 5);
      text.setAttribute('font-family', 'JetBrains Mono');
      text.setAttribute('font-size', '12');
      text.setAttribute('font-weight', 'bold');
      text.setAttribute('fill', '#f8fafc');
      text.setAttribute('text-anchor', 'middle');
      text.textContent = tx;
      precedenceSvg.appendChild(text);
    });

    if (!edges || edges.length === 0) {
      const emptyText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      emptyText.setAttribute('x', centerX);
      emptyText.setAttribute('y', centerY + (activeTxs.length > 2 ? 0 : 45));
      emptyText.setAttribute('font-family', 'Plus Jakarta Sans');
      emptyText.setAttribute('font-size', '11');
      emptyText.setAttribute('fill', '#64748b');
      emptyText.setAttribute('text-anchor', 'middle');
      emptyText.textContent = 'No conflict dependency edges';
      precedenceSvg.appendChild(emptyText);
    }
  }

  // Trace Playback (Staggered by ~40ms with Skip Option) (Section 4.6)
  function clearTracePlayback() {
    tracePlaybackTimers.forEach(t => clearTimeout(t));
    tracePlaybackTimers = [];
  }

  function renderTraceLogs(logs, skipAnimation = false) {
    if (!traceLogContainer) return;
    clearTracePlayback();
    currentTraceLogs = logs || [];

    traceLogContainer.innerHTML = '';

    if (!logs || logs.length === 0) {
      traceLogContainer.innerHTML = '<div class="text-slate-500 italic">No execution trace recorded.</div>';
      if (btnSkipTrace) btnSkipTrace.classList.add('hidden');
      return;
    }

    if (skipAnimation) {
      logs.forEach(l => appendTraceLine(l));
      if (btnSkipTrace) btnSkipTrace.classList.add('hidden');
      traceLogContainer.scrollTop = traceLogContainer.scrollHeight;
      return;
    }

    // Staggered line playback
    if (btnSkipTrace) btnSkipTrace.classList.remove('hidden');

    logs.forEach((logItem, index) => {
      const timer = setTimeout(() => {
        appendTraceLine(logItem);
        traceLogContainer.scrollTop = traceLogContainer.scrollHeight;

        if (index === logs.length - 1) {
          if (btnSkipTrace) btnSkipTrace.classList.add('hidden');
        }
      }, index * 40);
      tracePlaybackTimers.push(timer);
    });
  }

  function appendTraceLine(l) {
    const row = document.createElement('div');
    row.className = 'p-2 rounded-lg bg-slate-900 border border-slate-800 text-[11px] font-mono flex items-center justify-between gap-2 shadow-sm';

    const statusText = l.status || l.level || 'OK';
    let statusBadgeColor = 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30';

    if (statusText.includes('DEADLOCK') || statusText.includes('ROLLED_BACK') || statusText === 'rollback') {
      statusBadgeColor = 'text-rose-400 bg-rose-500/10 border-rose-500/30';
    } else if (statusText.includes('WAIT') || statusText.includes('BLOCKED') || statusText === 'wait') {
      statusBadgeColor = 'text-amber-400 bg-amber-500/10 border-amber-500/30';
    } else if (statusText.includes('TIMEOUT') || statusText === 'timeout') {
      statusBadgeColor = 'text-rose-300 bg-rose-500/20 border-rose-500/40';
    }

    const stepLabel = l.stepIndex !== undefined ? `S${l.stepIndex}` : (l.step !== undefined ? `S${l.step}` : 'TRACE');
    const txLabel = l.txId || (l.tx ? `T${l.tx}` : '');
    const opLabel = l.op || '';
    const detail = l.detail || l.text || '';
    const dur = l.durationMs !== undefined ? `${l.durationMs}ms` : (l.tMs !== undefined ? `${l.tMs}ms` : '');

    row.innerHTML = `
      <div class="flex items-center gap-1.5 min-w-0">
        <span class="text-sky-400 font-bold">${stepLabel}</span>
        <span class="text-slate-400">${txLabel}${opLabel ? '.' + opLabel : ''}</span>
        <span class="text-slate-300 truncate">${escapeHtml(detail)}</span>
      </div>
      <div class="flex items-center gap-1.5 flex-shrink-0">
        <span class="px-1.5 py-0.5 rounded text-[10px] border ${statusBadgeColor}">${statusText}</span>
        ${dur ? `<span class="text-[10px] text-slate-500">${dur}</span>` : ''}
      </div>
    `;

    traceLogContainer.appendChild(row);
  }

  // ==========================================================================
  // 9. MAIN BUTTON FLOW & EXECUTION (Section 4.6)
  // ==========================================================================
  async function handleMainActionClick() {
    if (STATE.mode === 'BUSY') return;

    if (STATE.schedule.length === 0) {
      showToast('Please place at least one operation block in the schedule matrix.', 'warning');
      return;
    }

    if (STATE.mode === 'SIMULATE') {
      await runSimulateMode();
    } else if (STATE.mode === 'FIX') {
      await runFixMode();
    }
  }

  async function runSimulateMode() {
    setBusy(true);

    try {
      // Map schedule to backend API payload
      const ops = STATE.schedule.map(s => ({
        id: s.id,
        txId: s.tx,
        stepIndex: s.step,
        op: s.type,
        account: s.account,
        amount: s.delta || 0,
        // DTO aliases for backend flexibility
        tx: parseInt(s.tx.replace('T', ''), 10) || 1,
        step: s.step,
        type: s.type,
        delta: s.delta || 0,
      }));

      const payload = {
        txCount: STATE.txCount,
        schedule: ops,
        ops: ops,
        controlMode: 'NONE',
        isolation: STATE.isolation,
      };

      const result = await API.simulate(payload);
      STATE.lastResult = result;

      // Handle unified response shape
      const analysis = result.analysis || {
        isSerializable: result.serializable !== undefined ? result.serializable : true,
        hasHazards: result.hazards && result.hazards.length > 0,
        hazards: result.hazards || [],
        precedenceEdges: (result.graph && result.graph.edges) ? result.graph.edges : [],
        cycleNodes: result.cycleNodes || [],
      };

      renderAnalysisResults(analysis);
      renderPrecedenceGraph(
        analysis.precedenceEdges || (result.graph ? result.graph.edges : []),
        analysis.cycleNodes || []
      );

      const logs = result.executionLogs || result.trace || [];
      renderTraceLogs(logs);

      if (result.finalAccounts || result.accounts) {
        updateBalancesUI(result.finalAccounts || result.accounts);
      }

      const hasAnomalies = analysis.hasHazards || analysis.cycleDetected || !analysis.isSerializable;

      if (hasAnomalies) {
        transformToFixState();
        showToast('Serialization hazards detected! Click "Fix Problem" to apply Strict 2PL.', 'warning');
      } else {
        resetToSimulateState();
        if (statusDot) statusDot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-500';
        if (serializableBadge) {
          serializableBadge.className = 'badge-status text-[11px] font-mono px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40';
          serializableBadge.textContent = 'Conflict Serializable (Safe)';
        }
        showToast('Schedule is conflict serializable and anomaly-free.', 'success');
      }
    } catch (err) {
      showToast(`Simulation Error: ${err.message}`, 'error');
      resetToSimulateState();
    } finally {
      setBusy(false);
    }
  }

  async function runFixMode() {
    setBusy(true);

    try {
      const ops = STATE.schedule.map(s => ({
        id: s.id,
        txId: s.tx,
        stepIndex: s.step,
        op: s.type,
        account: s.account,
        amount: s.delta || 0,
        tx: parseInt(s.tx.replace('T', ''), 10) || 1,
        step: s.step,
        type: s.type,
        delta: s.delta || 0,
      }));

      const payload = {
        txCount: STATE.txCount,
        schedule: ops,
        ops: ops,
        controlMode: 'STRICT_2PL',
        isolation: 'SERIALIZABLE',
      };

      const res = await API.executeSafe(payload);
      const result = res.simulation || res;
      STATE.lastResult = result;

      // Extract resolved effective order and update Concurrent Timelines matrix
      const resolvedOrder = res.fixedSchedule || result.effectiveOrder || result.fixedSchedule;
      if (resolvedOrder && resolvedOrder.length > 0) {
        // Expand stepRows if the fixed schedule has more steps
        const maxStepInResolved = Math.max(...resolvedOrder.map(s => s.stepIndex || s.step || 0), 0);
        STATE.stepRows = Math.max(STATE.stepRows, maxStepInResolved + 1);

        // Update schedule state with the serialized safe operations
        STATE.schedule = resolvedOrder.map((s, idx) => ({
          id: s.id || `fixed_${idx}_${Date.now()}`,
          step: s.stepIndex !== undefined ? s.stepIndex : s.step,
          tx: s.txId || (s.tx ? (typeof s.tx === 'number' ? `T${s.tx}` : s.tx) : 'T1'),
          type: s.op || s.type,
          account: s.account,
          delta: s.amount !== undefined ? s.amount : (s.delta || 0),
        }));

        sortSchedule();
        renderMatrix();
        renderSequenceStream(STATE.schedule, 'Strict 2PL Enforced Order:');
      }

      if (result.analysis) {
        renderAnalysisResults(result.analysis);
        renderPrecedenceGraph(result.analysis.precedenceEdges, result.analysis.cycleNodes);
      } else {
        renderAnalysisResults({ hasHazards: false, hazards: [] });
        renderPrecedenceGraph([], []);
      }

      const logs = result.executionLogs || result.trace || [];
      renderTraceLogs(logs);

      if (result.finalAccounts || result.accounts) {
        updateBalancesUI(result.finalAccounts || result.accounts);
      }

      resetToSimulateState();
      if (statusDot) statusDot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-500';
      if (serializableBadge) {
        serializableBadge.className = 'badge-status text-[11px] font-mono px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40';
        serializableBadge.textContent = 'Strict 2PL Enforced (Safe)';
      }

      showToast(res.fixMessage || 'Strict 2PL Concurrency Control applied. All hazards resolved!', 'success');
    } catch (err) {
      showToast(`Strict 2PL Error: ${err.message}`, 'error');
      resetToSimulateState();
    } finally {
      setBusy(false);
    }
  }

  function setBusy(isBusy) {
    if (isBusy) {
      STATE.mode = 'BUSY';
      if (btnMainAction) btnMainAction.disabled = true;
      if (actionSpinner) actionSpinner.classList.remove('hidden');
      if (actionIcon) actionIcon.classList.add('hidden');
      window.DragDropModule.setDisabled(true);
    } else {
      if (btnMainAction) btnMainAction.disabled = false;
      if (actionSpinner) actionSpinner.classList.add('hidden');
      if (actionIcon) actionIcon.classList.remove('hidden');
      window.DragDropModule.setDisabled(false);
    }
  }

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
      btnMainAction.className = 'btn-primary-action inline-flex items-center gap-2 px-5 py-2 rounded-xl font-semibold text-xs sm:text-sm text-white bg-amber-500 hover:bg-amber-400 shadow-lg shadow-amber-500/30 transition-all pulse-fix-btn';
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
  // 10. PRESETS (12 Canonical Data-Only Definitions) (Section 4.7)
  // ==========================================================================
  const PRESETS = {
    // 1. Lost Update (P4 Conflict)
    lost_update: {
      name: 'Lost Update',
      txCount: 2,
      steps: [
        { tx: 'T1', step: 1, type: 'READ', account: 'A', delta: 0 },
        { tx: 'T2', step: 2, type: 'READ', account: 'A', delta: 0 },
        { tx: 'T1', step: 3, type: 'WRITE', account: 'A', delta: 200 },
        { tx: 'T2', step: 4, type: 'WRITE', account: 'A', delta: -200 },
        { tx: 'T1', step: 5, type: 'COMMIT', account: 'ALL', delta: 0 },
        { tx: 'T2', step: 6, type: 'COMMIT', account: 'ALL', delta: 0 },
      ],
      toast: 'Loaded Preset: Lost Update (P4 Conflict on Account A).',
    },

    // 2. Dirty Read (G1 Hazard)
    dirty_read: {
      name: 'Dirty Read',
      txCount: 2,
      steps: [
        { tx: 'T1', step: 1, type: 'WRITE', account: 'A', delta: 500 },
        { tx: 'T2', step: 2, type: 'READ', account: 'A', delta: 0 },
        { tx: 'T1', step: 3, type: 'ROLLBACK', account: 'ALL', delta: 0 },
        { tx: 'T2', step: 4, type: 'COMMIT', account: 'ALL', delta: 0 },
      ],
      toast: 'Loaded Preset: Dirty Read (G1 Hazard on Account A).',
    },

    // 3. Non-Repeatable Read (Fuzzy Read)
    non_repeatable_read: {
      name: 'Non-Repeatable Read',
      txCount: 2,
      steps: [
        { tx: 'T1', step: 1, type: 'READ', account: 'A', delta: 0 },
        { tx: 'T2', step: 2, type: 'WRITE', account: 'A', delta: 300 },
        { tx: 'T2', step: 3, type: 'COMMIT', account: 'ALL', delta: 0 },
        { tx: 'T1', step: 4, type: 'READ', account: 'A', delta: 0 },
        { tx: 'T1', step: 5, type: 'COMMIT', account: 'ALL', delta: 0 },
      ],
      toast: 'Loaded Preset: Non-Repeatable Read (Fuzzy Read on Account A).',
    },

    // 4. Write Skew
    write_skew: {
      name: 'Write Skew',
      txCount: 2,
      steps: [
        { tx: 'T1', step: 1, type: 'READ', account: 'A', delta: 0 },
        { tx: 'T1', step: 2, type: 'READ', account: 'B', delta: 0 },
        { tx: 'T2', step: 3, type: 'READ', account: 'A', delta: 0 },
        { tx: 'T2', step: 4, type: 'READ', account: 'B', delta: 0 },
        { tx: 'T1', step: 5, type: 'WRITE', account: 'A', delta: -300 },
        { tx: 'T2', step: 6, type: 'WRITE', account: 'B', delta: -300 },
        { tx: 'T1', step: 7, type: 'COMMIT', account: 'ALL', delta: 0 },
        { tx: 'T2', step: 8, type: 'COMMIT', account: 'ALL', delta: 0 },
      ],
      toast: 'Loaded Preset: Write Skew Anomaly.',
    },

    // 5. Cascading Rollback
    cascading_rollback: {
      name: 'Cascading Rollback',
      txCount: 2,
      steps: [
        { tx: 'T1', step: 1, type: 'WRITE', account: 'A', delta: 300 },
        { tx: 'T2', step: 2, type: 'READ', account: 'A', delta: 0 },
        { tx: 'T2', step: 3, type: 'WRITE', account: 'B', delta: 200 },
        { tx: 'T1', step: 4, type: 'ROLLBACK', account: 'ALL', delta: 0 },
        { tx: 'T2', step: 5, type: 'COMMIT', account: 'ALL', delta: 0 },
      ],
      toast: 'Loaded Preset: Cascading Rollback Hazard.',
    },

    // 6. 2-Way Deadlock Cycle
    deadlock_2way: {
      name: '2-Way Deadlock',
      txCount: 2,
      steps: [
        { tx: 'T1', step: 1, type: 'WRITE', account: 'A', delta: 200 },
        { tx: 'T2', step: 2, type: 'WRITE', account: 'B', delta: 200 },
        { tx: 'T1', step: 3, type: 'WRITE', account: 'B', delta: 200 },
        { tx: 'T2', step: 4, type: 'WRITE', account: 'A', delta: 200 },
        { tx: 'T1', step: 5, type: 'COMMIT', account: 'ALL', delta: 0 },
        { tx: 'T2', step: 6, type: 'COMMIT', account: 'ALL', delta: 0 },
      ],
      toast: 'Loaded Preset: 2-Way Circular Deadlock Cycle.',
    },

    // 7. 3-Way Deadlock (T1->T2->T3->T1)
    deadlock_3way: {
      name: '3-Way Deadlock',
      txCount: 3,
      steps: [
        { tx: 'T1', step: 1, type: 'WRITE', account: 'A', delta: 100 },
        { tx: 'T2', step: 2, type: 'WRITE', account: 'B', delta: 100 },
        { tx: 'T3', step: 3, type: 'WRITE', account: 'C', delta: 100 },
        { tx: 'T1', step: 4, type: 'WRITE', account: 'B', delta: 100 },
        { tx: 'T2', step: 5, type: 'WRITE', account: 'C', delta: 100 },
        { tx: 'T3', step: 6, type: 'WRITE', account: 'A', delta: 100 },
        { tx: 'T1', step: 7, type: 'COMMIT', account: 'ALL', delta: 0 },
        { tx: 'T2', step: 8, type: 'COMMIT', account: 'ALL', delta: 0 },
        { tx: 'T3', step: 9, type: 'COMMIT', account: 'ALL', delta: 0 },
      ],
      toast: 'Loaded Preset: 3-Way Deadlock Ring (T1→T2→T3→T1).',
    },

    // 8. 4-Way Distributed Deadlock Ring
    deadlock_4way: {
      name: '4-Way Deadlock',
      txCount: 4,
      steps: [
        { tx: 'T1', step: 1, type: 'WRITE', account: 'A', delta: 100 },
        { tx: 'T2', step: 2, type: 'WRITE', account: 'B', delta: 100 },
        { tx: 'T3', step: 3, type: 'WRITE', account: 'C', delta: 100 },
        { tx: 'T4', step: 4, type: 'WRITE', account: 'A', delta: -100 },
        { tx: 'T1', step: 5, type: 'WRITE', account: 'B', delta: 100 },
        { tx: 'T2', step: 6, type: 'WRITE', account: 'C', delta: 100 },
        { tx: 'T3', step: 7, type: 'WRITE', account: 'A', delta: 100 },
        { tx: 'T4', step: 8, type: 'WRITE', account: 'B', delta: 100 },
        { tx: 'T1', step: 9, type: 'COMMIT', account: 'ALL', delta: 0 },
        { tx: 'T2', step: 10, type: 'COMMIT', account: 'ALL', delta: 0 },
        { tx: 'T3', step: 11, type: 'COMMIT', account: 'ALL', delta: 0 },
        { tx: 'T4', step: 12, type: 'COMMIT', account: 'ALL', delta: 0 },
      ],
      toast: 'Loaded Preset: 4-Way Distributed Deadlock Ring.',
    },

    // 9. Safe Serial Pipeline
    safe_serial: {
      name: 'Safe Serial Pipeline',
      txCount: 3,
      steps: [
        { tx: 'T1', step: 1, type: 'READ', account: 'A', delta: 0 },
        { tx: 'T1', step: 2, type: 'WRITE', account: 'A', delta: -150 },
        { tx: 'T1', step: 3, type: 'COMMIT', account: 'ALL', delta: 0 },
        { tx: 'T2', step: 4, type: 'READ', account: 'A', delta: 0 },
        { tx: 'T2', step: 5, type: 'WRITE', account: 'B', delta: 150 },
        { tx: 'T2', step: 6, type: 'COMMIT', account: 'ALL', delta: 0 },
        { tx: 'T3', step: 7, type: 'READ', account: 'B', delta: 0 },
        { tx: 'T3', step: 8, type: 'COMMIT', account: 'ALL', delta: 0 },
      ],
      toast: 'Loaded Preset: Safe Serial Pipeline.',
    },

    // 10. Disjoint Accounts
    disjoint_accounts: {
      name: 'Disjoint Accounts',
      txCount: 2,
      steps: [
        { tx: 'T1', step: 1, type: 'READ', account: 'A', delta: 0 },
        { tx: 'T2', step: 2, type: 'READ', account: 'B', delta: 0 },
        { tx: 'T1', step: 3, type: 'WRITE', account: 'A', delta: 150 },
        { tx: 'T2', step: 4, type: 'WRITE', account: 'B', delta: -150 },
        { tx: 'T1', step: 5, type: 'COMMIT', account: 'ALL', delta: 0 },
        { tx: 'T2', step: 6, type: 'COMMIT', account: 'ALL', delta: 0 },
      ],
      toast: 'Loaded Preset: Disjoint Accounts (Independent Transactions).',
    },

    // 11. Concurrent Reads
    concurrent_reads: {
      name: 'Concurrent Reads',
      txCount: 3,
      steps: [
        { tx: 'T1', step: 1, type: 'READ', account: 'A', delta: 0 },
        { tx: 'T2', step: 2, type: 'READ', account: 'A', delta: 0 },
        { tx: 'T3', step: 3, type: 'READ', account: 'A', delta: 0 },
        { tx: 'T1', step: 4, type: 'READ', account: 'B', delta: 0 },
        { tx: 'T2', step: 5, type: 'READ', account: 'B', delta: 0 },
        { tx: 'T1', step: 6, type: 'COMMIT', account: 'ALL', delta: 0 },
        { tx: 'T2', step: 7, type: 'COMMIT', account: 'ALL', delta: 0 },
        { tx: 'T3', step: 8, type: 'COMMIT', account: 'ALL', delta: 0 },
      ],
      toast: 'Loaded Preset: Concurrent Reads (Shared Locks).',
    },

    // 12. Transfer Chain
    transfer_chain: {
      name: 'Transfer Chain',
      txCount: 3,
      steps: [
        { tx: 'T1', step: 1, type: 'READ', account: 'A', delta: 0 },
        { tx: 'T1', step: 2, type: 'WRITE', account: 'A', delta: -100 },
        { tx: 'T1', step: 3, type: 'READ', account: 'B', delta: 0 },
        { tx: 'T1', step: 4, type: 'WRITE', account: 'B', delta: 100 },
        { tx: 'T1', step: 5, type: 'COMMIT', account: 'ALL', delta: 0 },
        { tx: 'T2', step: 6, type: 'READ', account: 'B', delta: 0 },
        { tx: 'T2', step: 7, type: 'WRITE', account: 'B', delta: -100 },
        { tx: 'T2', step: 8, type: 'READ', account: 'C', delta: 0 },
        { tx: 'T2', step: 9, type: 'WRITE', account: 'C', delta: 100 },
        { tx: 'T2', step: 10, type: 'COMMIT', account: 'ALL', delta: 0 },
        { tx: 'T3', step: 11, type: 'READ', account: 'C', delta: 0 },
        { tx: 'T3', step: 12, type: 'COMMIT', account: 'ALL', delta: 0 },
      ],
      toast: 'Loaded Preset: Transfer Chain (Sequential Transfers).',
    },
  };

  function loadPreset(presetKey) {
    const preset = PRESETS[presetKey];
    if (!preset) return;

    STATE.txCount = preset.txCount;
    if (txCountSelect) txCountSelect.value = preset.txCount;
    txCountButtons.forEach(btn => {
      const btnCount = parseInt(btn.getAttribute('data-count'), 10);
      btn.classList.toggle('active', btnCount === preset.txCount);
      if (btnCount === preset.txCount) {
        btn.className = 'tx-btn active px-3 py-1 text-xs font-mono font-semibold rounded-lg bg-sky-500/20 text-sky-400 border border-sky-500/40 shadow-sm';
      } else {
        btn.className = 'tx-btn px-3 py-1 text-xs font-mono font-semibold rounded-lg text-slate-400 hover:text-slate-200 transition';
      }
    });

    const maxStepInPreset = Math.max(...preset.steps.map(s => s.step), 0);
    STATE.stepRows = Math.max(8, maxStepInPreset + 1);

    // Deep copy steps and assign unique ids
    STATE.schedule = preset.steps.map((s, idx) => ({
      id: `preset_${presetKey}_${idx}_${Date.now()}`,
      step: s.step,
      tx: s.tx,
      type: s.type,
      account: s.account,
      delta: s.delta || 0,
    }));

    sortSchedule();
    onScheduleChange();
    showToast(preset.toast, 'info');
  }

  // ==========================================================================
  // 11. TOAST NOTIFICATIONS (Section 4.2)
  // ==========================================================================
  let toastTimer = null;
  function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toastMessage');
    if (!toast || !toastMessage) return;

    if (toastTimer) clearTimeout(toastTimer);

    let borderColor = 'border-slate-700';
    let icon = 'ℹ️';

    if (type === 'warning') {
      borderColor = 'border-amber-500/60 bg-slate-900/95 text-amber-200';
      icon = '⚠️';
    } else if (type === 'error') {
      borderColor = 'border-rose-500/60 bg-slate-900/95 text-rose-200';
      icon = '❌';
    } else if (type === 'success') {
      borderColor = 'border-emerald-500/60 bg-slate-900/95 text-emerald-200';
      icon = '✅';
    } else {
      borderColor = 'border-sky-500/50 bg-slate-900/95 text-sky-200';
      icon = 'ℹ️';
    }

    toastMessage.className = `flex items-center gap-2.5 px-4 py-2.5 rounded-xl border text-xs sm:text-sm font-medium shadow-2xl backdrop-blur-md ${borderColor}`;
    toastMessage.innerHTML = `<span>${icon}</span> <span>${escapeHtml(message)}</span>`;

    toast.classList.remove('translate-y-20', 'opacity-0');
    toast.classList.add('translate-y-0', 'opacity-100');

    toastTimer = setTimeout(() => {
      toast.classList.remove('translate-y-0', 'opacity-100');
      toast.classList.add('translate-y-20', 'opacity-0');
    }, 3800);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    }[m]));
  }

  // ==========================================================================
  // 12. INITIALIZATION & EVENT LISTENERS
  // ==========================================================================
  function init() {
    // 1. Initialize Drag & Drop Module
    window.DragDropModule.init({
      onPlace: handlePlaceBlock,
      onMove: handleMoveBlock,
      onRemove: handleRemoveBlock,
      canPlace: canPlace,
      showToast: showToast,
      isBusy: () => STATE.mode === 'BUSY',
    });

    setupEventListeners();

    // 2. Fetch live account balances and render initial matrix
    API.getAccounts()
      .then(accounts => updateBalancesUI(accounts))
      .catch(() => updatePalettePreview());

    // 3. Render initial views
    renderMatrix();
    renderSequenceStream();
    clearAnalysisViews();

    // 4. Load initial default scenario preset (Lost Update)
    loadPreset('lost_update');
  }

  function setupEventListeners() {
    // Transaction Concurrency Buttons
    txCountButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const count = parseInt(btn.getAttribute('data-count'), 10);
        setTxCount(count);
      });
    });

    if (txCountSelect) {
      txCountSelect.addEventListener('change', () => {
        setTxCount(parseInt(txCountSelect.value, 10));
      });
    }

    // Optional Isolation Level Selector (Milestone 4 Stretch Goal)
    if (isolationSelect) {
      isolationSelect.addEventListener('change', () => {
        STATE.isolation = isolationSelect.value;
        showToast(`Isolation level set to ${STATE.isolation}.`, 'info');
      });
    }

    // Load Scenario Preset
    if (btnLoadPreset) {
      btnLoadPreset.addEventListener('click', () => {
        const key = presetSelect ? presetSelect.value : '';
        if (key && PRESETS[key]) {
          loadPreset(key);
        } else {
          showToast('Please select a scenario preset from the dropdown.', 'warning');
        }
      });
    }

    if (presetSelect) {
      presetSelect.addEventListener('change', () => {
        const key = presetSelect.value;
        if (key && PRESETS[key]) {
          loadPreset(key);
        }
      });
    }

    // Clear Timeline
    if (btnClearTimeline) {
      btnClearTimeline.addEventListener('click', () => {
        STATE.schedule = [];
        onScheduleChange();
        showToast('All operations cleared from the schedule.', 'info');
      });
    }

    // Reset Database
    if (btnResetDB) {
      btnResetDB.addEventListener('click', async () => {
        try {
          const resp = await API.resetDatabase();
          updateBalancesUI(resp.accounts);
          clearAnalysisViews();
          resetToSimulateState();
          showToast('Database reset: Accounts restored to $1,000.00 baseline.', 'success');
        } catch (err) {
          showToast(`Error resetting database: ${err.message}`, 'error');
        }
      });
    }

    // Add Step Row
    if (btnAddStepRow) {
      btnAddStepRow.addEventListener('click', addStepRow);
    }

    // Main Action Button (Simulate / Fix)
    if (btnMainAction) {
      btnMainAction.addEventListener('click', handleMainActionClick);
    }

    // Skip Trace Playback Button
    if (btnSkipTrace) {
      btnSkipTrace.addEventListener('click', () => {
        renderTraceLogs(currentTraceLogs, true);
      });
    }

    // Palette Account & Delta Selector Changes
    if (paletteAccount) {
      paletteAccount.addEventListener('change', updatePalettePreview);
    }
    if (paletteDelta) {
      paletteDelta.addEventListener('change', updatePalettePreview);
    }

    // Keyboard Shortcuts (Milestone 5 Accessibility Pass)
    window.addEventListener('keydown', (e) => {
      // Don't intercept when user is typing in select or inputs
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;

      // 1-4 keys to switch transaction count
      if (['1', '2', '3', '4'].includes(e.key) && !e.ctrlKey && !e.altKey && !e.metaKey) {
        setTxCount(parseInt(e.key, 10));
      }

      // Enter key to trigger Simulate/Fix
      if (e.key === 'Enter' && !e.shiftKey) {
        handleMainActionClick();
      }

      // Escape key to clear touch selection
      if (e.key === 'Escape') {
        window.DragDropModule.clearTouchSelection();
      }
    });
  }

  // Run on DOM Ready
  window.addEventListener('DOMContentLoaded', init);
})();

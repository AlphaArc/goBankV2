/**
 * Main Application Controller for goBankV2
 */

(function () {
  const STATE = {
    txCount: 2,
    mode: 'SIMULATE', // 'SIMULATE' or 'FIX'
    accounts: {},
    currentSchedule: [],
    lastResult: null,
  };

  // DOM Elements
  const txCountButtons = document.querySelectorAll('.tx-btn');
  const txCountSelect = document.getElementById('txCountSelect');
  const timelinesList = document.getElementById('timelinesList');
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
    renderTimelines();
    fetchAccountBalances();
    // Load a default educational scenario to start
    loadPreset('lost_update');
  }

  function setupEventListeners() {
    // Transaction Count Selector (Dropdown & Button Group)
    if (txCountSelect) {
      txCountSelect.addEventListener('change', () => {
        setTxCount(parseInt(txCountSelect.value, 10));
        resetToSimulateState();
      });
    }

    txCountButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        setTxCount(parseInt(btn.getAttribute('data-count'), 10));
        resetToSimulateState();
      });
    });

    // Main Simulate / Fix Action Button
    btnMainAction.addEventListener('click', handleMainActionClick);

    // Clear Timeline
    btnClearTimeline.addEventListener('click', () => {
      clearAllSlots();
      resetToSimulateState();
      showToast('Timelines cleared.');
    });

    // Preset Scenarios
    btnLoadPreset.addEventListener('click', () => {
      const selected = presetSelect.value;
      if (selected) {
        loadPreset(selected);
      } else {
        showToast('Please select a scenario from the dropdown.');
      }
    });

    // Reset Database
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

  // ==========================================================================
  // Timelines Rendering
  // ==========================================================================

  function renderTimelines() {
    timelinesList.innerHTML = '';
    const txNames = ['T1', 'T2', 'T3', 'T4'];

    for (let i = 0; i < STATE.txCount; i++) {
      const txId = txNames[i];
      const row = document.createElement('div');
      row.className = 'tx-row';
      row.dataset.tx = txId;

      row.innerHTML = `
        <div class="tx-meta">
          <div class="tx-badge">${txId}</div>
          <span class="tx-state-tag">Idle</span>
        </div>
        <div class="tx-slots-track" id="track_${txId}"></div>
      `;

      const track = row.querySelector(`#track_${txId}`);
      for (let step = 1; step <= 8; step++) {
        const slot = document.createElement('div');
        slot.className = 'timeline-slot';
        slot.dataset.tx = txId;
        slot.dataset.step = step;
        window.DragDropModule.bindSlotEvents(slot);
        track.appendChild(slot);
      }

      timelinesList.appendChild(row);
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
      sequenceStream.innerHTML = '<span class="sequence-empty">No operations placed — drag blocks into timelines above</span>';
      return;
    }

    sequenceStream.innerHTML = '';
    schedule.forEach((s, idx) => {
      const pill = document.createElement('div');
      pill.className = `seq-pill op-${s.op}`;

      let label = `${s.txId}.${s.op}`;
      if (s.op === 'READ') {
        label += `(${s.account})`;
      } else if (s.op === 'WRITE') {
        const sign = s.amount >= 0 ? '+' : '';
        label += `(${s.account}, ${sign}$${s.amount})`;
      }

      pill.innerHTML = `<strong>S${s.stepIndex}:</strong> ${label}`;
      sequenceStream.appendChild(pill);

      if (idx < schedule.length - 1) {
        const arrow = document.createElement('span');
        arrow.className = 'seq-arrow';
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
    btnMainAction.className = 'btn-primary-action simulate-state';
    actionButtonText.textContent = 'Simulate Schedule';
    actionIcon.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polygon points="5 3 19 12 5 21 5 3"></polygon>
      </svg>
    `;
    statusDot.className = 'status-indicator-dot';
    serializableBadge.className = 'badge-status';
    serializableBadge.textContent = 'Ready';
  }

  function transformToFixState() {
    STATE.mode = 'FIX';
    btnMainAction.className = 'btn-primary-action fix-state';
    actionButtonText.textContent = 'Fix Problem (Strict 2PL)';
    actionIcon.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
      </svg>
    `;
    statusDot.className = 'status-indicator-dot dot-hazard';
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
      await runFix(schedule);
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

      console.log('------------------------------------------------------------');
      console.log('[goBankV2 Frontend] Dispathing Schedule to POST /simulate:');
      console.log(JSON.stringify(payload, null, 2));
      console.log('------------------------------------------------------------');

      const resp = await fetch('/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        throw new Error(`Simulation failed: ${resp.statusText}`);
      }

      const result = await resp.json();
      STATE.lastResult = result;

      // Update UI components
      renderHazards(result.analysis);
      renderPrecedenceGraph(result.analysis);
      renderExecutionLogs(result.executionLogs);
      updateBalancesUI(result.finalAccounts);

      if (result.analysis.hasHazards) {
        transformToFixState();
        showToast(`Hazards detected! Click "Fix Problem" to apply Strict 2PL.`);
      } else {
        statusDot.className = 'status-indicator-dot dot-safe';
        serializableBadge.className = 'badge-status badge-safe';
        serializableBadge.textContent = 'Conflict Serializable';
        showToast('Schedule is safe and Conflict Serializable!');
      }
    } catch (err) {
      showToast('Error during simulation: ' + err.message);
    }
  }

  async function runFix(schedule) {
    try {
      const resp = await fetch('/api/fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          txCount: STATE.txCount,
          schedule: schedule,
          controlMode: 'STRICT_2PL',
        }),
      });

      if (!resp.ok) {
        throw new Error(`Fix failed: ${resp.statusText}`);
      }

      const data = await resp.json();
      const sim = data.simulation;
      const fixedSchedule = data.fixedSchedule;

      // Re-populate the timeline slots with the fixed schedule
      populateTimelineFromSchedule(fixedSchedule);

      // Render updated safe results
      renderSafeResolution(data.fixMessage, sim);
      renderPrecedenceGraph(sim.analysis);
      renderExecutionLogs(sim.executionLogs);
      updateBalancesUI(sim.finalAccounts);

      // Reset button state
      resetToSimulateState();
      statusDot.className = 'status-indicator-dot dot-fixed';
      serializableBadge.className = 'badge-status badge-safe';
      serializableBadge.textContent = 'Strict 2PL Enforced';

      showToast('Problem Fixed: Strict 2PL concurrency control applied!');
    } catch (err) {
      showToast('Error applying fix: ' + err.message);
    }
  }

  function setButtonLoading(loading) {
    if (loading) {
      actionSpinner.classList.remove('hidden');
      actionIcon.classList.add('hidden');
      btnMainAction.disabled = true;
    } else {
      actionSpinner.classList.add('hidden');
      actionIcon.classList.remove('hidden');
      btnMainAction.disabled = false;
    }
  }

  // ==========================================================================
  // Results & Graph Visualizers
  // ==========================================================================

  function renderHazards(analysis) {
    hazardsContent.innerHTML = '';

    if (!analysis.hasHazards) {
      hazardsContent.innerHTML = `
        <div class="safe-banner">
          <h4>✓ No Concurrency Hazards Detected</h4>
          <p>The scheduled operations maintain serializability. No uncommitted dependencies, lost updates, or non-repeatable reads were observed.</p>
        </div>
      `;
      serializableBadge.className = 'badge-status badge-safe';
      serializableBadge.textContent = 'Serializable';
      return;
    }

    serializableBadge.className = 'badge-status badge-hazard';
    serializableBadge.textContent = `${analysis.hazards.length} Anomaly Hazard(s)`;

    const list = document.createElement('div');
    list.className = 'hazard-list';

    analysis.hazards.forEach(h => {
      const item = document.createElement('div');
      item.className = 'hazard-item';
      item.innerHTML = `
        <div class="hazard-title-row">
          <span class="hazard-title">${escapeHtml(h.title)}</span>
          <span class="hazard-tag">${escapeHtml(h.type)}</span>
        </div>
        <p class="hazard-desc">${escapeHtml(h.description)}</p>
        <div class="hazard-hint"><strong>Solution:</strong> ${escapeHtml(h.fixHint)}</div>
      `;
      list.appendChild(item);
    });

    hazardsContent.appendChild(list);
  }

  function renderSafeResolution(message, simResult) {
    hazardsContent.innerHTML = `
      <div class="safe-banner">
        <h4>🔒 Concurrency Control Applied (Strict 2PL)</h4>
        <p>${escapeHtml(message)}</p>
        <p style="margin-top: 6px; font-size: 0.78rem; color: #a7f3d0;">
          All row operations acquired exclusive locks and held them through COMMIT, completely preventing race conditions.
        </p>
      </div>
    `;
  }

  function renderExecutionLogs(logs) {
    traceLogContainer.innerHTML = '';
    if (!logs || logs.length === 0) {
      traceLogContainer.innerHTML = '<div class="empty-state"><p>No operations executed.</p></div>';
      return;
    }

    logs.forEach(log => {
      const entry = document.createElement('div');
      entry.className = `trace-entry status-${log.status}`;

      let valText = '';
      if (log.observedValue !== undefined && log.observedValue !== null) {
        valText = ` | Read: $${log.observedValue.toFixed(2)}`;
      }
      if (log.writtenValue !== undefined && log.writtenValue !== null) {
        valText = ` | Balance: $${log.writtenValue.toFixed(2)}`;
      }

      entry.innerHTML = `
        <div class="trace-top">
          <span class="trace-step-tag">Step ${log.stepIndex}: [${log.txId}] ${log.op} (${log.account})</span>
          <span class="trace-duration">${log.durationMs}ms</span>
        </div>
        <div class="trace-detail">${escapeHtml(log.detail)}${valText}</div>
      `;
      traceLogContainer.appendChild(entry);
    });
  }

  function renderPrecedenceGraph(analysis) {
    precedenceSvg.innerHTML = '';
    const edges = analysis.precedenceEdges || [];

    // Node coordinates based on TxCount
    const nodes = {
      T1: { x: 80,  y: 70,  color: '#38bdf8' },
      T2: { x: 370, y: 70,  color: '#a855f7' },
      T3: { x: 80,  y: 170, color: '#f59e0b' },
      T4: { x: 370, y: 170, color: '#10b981' },
    };

    // Defs for arrow markers
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.innerHTML = `
      <marker id="arrow-hazard" viewBox="0 0 10 10" refX="22" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#f43f5e" />
      </marker>
      <marker id="arrow-safe" viewBox="0 0 10 10" refX="22" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#38bdf8" />
      </marker>
    `;
    precedenceSvg.appendChild(defs);

    // Draw active transaction nodes
    for (let i = 1; i <= STATE.txCount; i++) {
      const tx = `T${i}`;
      const n = nodes[tx];

      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.innerHTML = `
        <circle cx="${n.x}" cy="${n.y}" r="22" fill="rgba(255,255,255,0.05)" stroke="${n.color}" stroke-width="2.5" />
        <text x="${n.x}" y="${n.y + 5}" font-family="JetBrains Mono" font-size="14" font-weight="bold" fill="#f1f5f9" text-anchor="middle">${tx}</text>
      `;
      precedenceSvg.appendChild(g);
    }

    // Draw conflict edges
    const isCycle = analysis.cycleDetected;
    edges.forEach((edge, idx) => {
      const src = nodes[edge.fromTx];
      const dst = nodes[edge.toTx];
      if (!src || !dst) return;

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const markerId = isCycle ? 'url(#arrow-hazard)' : 'url(#arrow-safe)';
      const strokeColor = isCycle ? '#f43f5e' : '#38bdf8';

      // Slight curve for visibility
      const midX = (src.x + dst.x) / 2;
      const midY = (src.y + dst.y) / 2 - (idx % 2 === 0 ? 25 : -25);

      path.setAttribute('d', `M ${src.x} ${src.y} Q ${midX} ${midY} ${dst.x} ${dst.y}`);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', strokeColor);
      path.setAttribute('stroke-width', '2');
      path.setAttribute('stroke-dasharray', isCycle ? '4 2' : 'none');
      path.setAttribute('marker-end', markerId);

      precedenceSvg.appendChild(path);

      // Label on edge
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

  // ==========================================================================
  // Preset Scenarios
  // ==========================================================================

  function loadPreset(scenarioKey) {
    clearAllSlots();
    resetToSimulateState();

    switch (scenarioKey) {
      case 'lost_update':
        setTxCount(2);
        // T1 reads A, T2 reads A, T1 updates A, T2 updates A
        setBlock('T1', 1, 'READ', 'A');
        setBlock('T2', 2, 'READ', 'A');
        setBlock('T1', 3, 'WRITE', 'A', 200);
        setBlock('T2', 4, 'WRITE', 'A', -200);
        setBlock('T1', 5, 'COMMIT', 'A');
        setBlock('T2', 6, 'COMMIT', 'A');
        showToast('Loaded Lost Update scenario (T2 blind write overwrites T1).');
        break;

      case 'dirty_read':
        setTxCount(2);
        // T1 writes A, T2 reads A before T1 commits, T1 rolls back
        setBlock('T1', 1, 'WRITE', 'A', 500);
        setBlock('T2', 2, 'READ', 'A');
        setBlock('T1', 3, 'ROLLBACK', 'A');
        setBlock('T2', 4, 'COMMIT', 'A');
        showToast('Loaded Dirty Read scenario (T2 reads uncommitted write of aborted T1).');
        break;

      case 'non_repeatable_read':
        setTxCount(2);
        // T1 reads A, T2 writes A and commits, T1 reads A again seeing different value
        setBlock('T1', 1, 'READ', 'A');
        setBlock('T2', 2, 'WRITE', 'A', 400);
        setBlock('T2', 3, 'COMMIT', 'A');
        setBlock('T1', 4, 'READ', 'A');
        setBlock('T1', 5, 'COMMIT', 'A');
        showToast('Loaded Non-Repeatable Read scenario.');
        break;

      case 'write_skew':
        setTxCount(2);
        // T1 reads A, B, writes A. T2 reads A, B, writes B.
        setBlock('T1', 1, 'READ', 'A');
        setBlock('T1', 2, 'READ', 'B');
        setBlock('T2', 3, 'READ', 'A');
        setBlock('T2', 4, 'READ', 'B');
        setBlock('T1', 5, 'WRITE', 'A', -400);
        setBlock('T2', 6, 'WRITE', 'B', -400);
        setBlock('T1', 7, 'COMMIT', 'A');
        setBlock('T2', 8, 'COMMIT', 'B');
        showToast('Loaded Write Skew scenario.');
        break;

      case 'deadlock_cycle':
        setTxCount(2);
        // T1 writes A, T2 writes B, T1 writes B (blocked), T2 writes A (deadlock loop)
        setBlock('T1', 1, 'WRITE', 'A', 100);
        setBlock('T2', 2, 'WRITE', 'B', 100);
        setBlock('T1', 3, 'WRITE', 'B', 100);
        setBlock('T2', 4, 'WRITE', 'A', 100);
        showToast('Loaded Serialization Cycle dependency loop.');
        break;

      case 'serial_safe':
        setTxCount(2);
        setBlock('T1', 1, 'READ', 'A');
        setBlock('T1', 2, 'WRITE', 'A', 200);
        setBlock('T1', 3, 'COMMIT', 'A');
        setBlock('T2', 4, 'READ', 'A');
        setBlock('T2', 5, 'WRITE', 'A', 300);
        setBlock('T2', 6, 'COMMIT', 'A');
        showToast('Loaded Safe Serial schedule.');
        break;
    }
  }

  function setTxCount(count) {
    STATE.txCount = count;
    if (txCountSelect) txCountSelect.value = count;
    txCountButtons.forEach(b => {
      b.classList.toggle('active', parseInt(b.getAttribute('data-count'), 10) === count);
    });
    renderTimelines();
    updateGlobalSequenceUI();
  }

  function setBlock(tx, step, op, account, amount = 0) {
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

  function populateTimelineFromSchedule(schedule) {
    clearAllSlots();
    schedule.forEach(s => {
      // Slot steps are 1..8
      if (s.stepIndex <= 8) {
        setBlock(s.txId, s.stepIndex, s.op, s.account, s.amount);
      }
    });
  }

  // ==========================================================================
  // Accounts Balance UI
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

  function updateBalancesUI(accounts) {
    if (!accounts) return;
    accounts.forEach(a => {
      if (a.accountCode === 'A' && balA) balA.textContent = `$${a.balance.toFixed(2)}`;
      if (a.accountCode === 'B' && balB) balB.textContent = `$${a.balance.toFixed(2)}`;
      if (a.accountCode === 'C' && balC) balC.textContent = `$${a.balance.toFixed(2)}`;
    });
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  function showToast(message) {
    const toastContainer = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
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

/**
 * Drag & Drop Module for goBankV2 Timeline Operations
 */

window.DragDropModule = (function () {
  let draggedData = null;
  let draggedBlockElement = null;
  let droppedInValidSlot = false;
  let onScheduleChangeCallback = null;

  function init(onScheduleChange) {
    onScheduleChangeCallback = onScheduleChange;
    setupPaletteDraggables();
  }

  function setupPaletteDraggables() {
    const paletteBlocks = document.querySelectorAll('.palette-block');
    paletteBlocks.forEach(block => {
      block.addEventListener('dragstart', handlePaletteDragStart);
      block.addEventListener('dragend', handleDragEnd);
    });
  }

  function handlePaletteDragStart(e) {
    const op = this.getAttribute('data-op');
    const account = document.getElementById('paletteAccount').value || 'A';
    const delta = parseFloat(document.getElementById('paletteDelta').value) || 200;

    draggedData = {
      isNew: true,
      op: op,
      account: (op === 'COMMIT' || op === 'ROLLBACK') ? 'ALL' : account,
      amount: op === 'WRITE' ? delta : 0,
    };
    draggedBlockElement = null;
    droppedInValidSlot = false;

    e.dataTransfer.setData('text/plain', JSON.stringify(draggedData));
    e.dataTransfer.effectAllowed = 'copy';
    this.classList.add('dragging');
  }

  function handleDragEnd() {
    this.classList.remove('opacity-50', 'ring-2', 'ring-sky-400');
    document.querySelectorAll('.timeline-slot').forEach(slot => {
      slot.classList.remove('border-sky-400', 'bg-slate-800/90', 'scale-[1.02]');
    });

    // Out-of-bounds deletion: If a placed block was dropped outside valid slots
    if (draggedData && !draggedData.isNew && !droppedInValidSlot && draggedBlockElement) {
      const blockToDelete = draggedBlockElement;
      // Tailwind fade-out transition classes
      blockToDelete.classList.add('transition-opacity', 'duration-300', 'opacity-0', 'scale-75', '-translate-y-2');
      setTimeout(() => {
        if (blockToDelete.parentElement) {
          blockToDelete.parentElement.innerHTML = '';
        }
        if (onScheduleChangeCallback) {
          onScheduleChangeCallback();
        }
      }, 300);
    }

    draggedData = null;
    draggedBlockElement = null;
    droppedInValidSlot = false;
  }

  function bindSlotEvents(slotElement) {
    slotElement.addEventListener('dragover', handleSlotDragOver);
    slotElement.addEventListener('dragleave', handleSlotDragLeave);
    slotElement.addEventListener('drop', handleSlotDrop);
  }

  function handleSlotDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    this.classList.add('border-sky-400', 'bg-slate-800/90', 'scale-[1.02]');
  }

  function handleSlotDragLeave() {
    this.classList.remove('border-sky-400', 'bg-slate-800/90', 'scale-[1.02]');
  }

  function handleSlotDrop(e) {
    e.preventDefault();
    this.classList.remove('drag-over');
    droppedInValidSlot = true;

    let payload = draggedData;
    if (!payload) {
      try {
        const raw = e.dataTransfer.getData('text/plain');
        if (raw) payload = JSON.parse(raw);
      } catch (err) {
        console.error('Failed to parse drag payload:', err);
      }
    }

    if (!payload) return;

    const targetTx = this.getAttribute('data-tx');
    const targetStep = parseInt(this.getAttribute('data-step'), 10);

    // If moving from another slot
    if (!payload.isNew && payload.sourceTx && payload.sourceStep) {
      const sourceSlot = document.querySelector(`.timeline-slot[data-tx="${payload.sourceTx}"][data-step="${payload.sourceStep}"]`);
      if (sourceSlot) {
        sourceSlot.innerHTML = '';
      }
    }

    // Place the block into this slot
    placeBlockInSlot(this, {
      txId: targetTx,
      stepIndex: targetStep,
      op: payload.op,
      account: payload.account,
      amount: payload.amount,
    });

    if (onScheduleChangeCallback) {
      onScheduleChangeCallback();
    }
  }

  function placeBlockInSlot(slotElement, blockData) {
    slotElement.innerHTML = ''; // Replace any existing block

    const blockDiv = document.createElement('div');
    blockDiv.setAttribute('draggable', 'true');
    blockDiv.dataset.tx = blockData.txId;
    blockDiv.dataset.step = blockData.stepIndex;
    blockDiv.dataset.op = blockData.op;
    blockDiv.dataset.account = blockData.account;
    blockDiv.dataset.amount = blockData.amount || 0;

    let opStyles = 'bg-sky-500/15 border-sky-500/40 text-sky-100';
    let opBadgeColor = 'text-sky-400';
    if (blockData.op === 'WRITE') {
      opStyles = 'bg-purple-500/15 border-purple-500/40 text-purple-100';
      opBadgeColor = 'text-purple-400';
    } else if (blockData.op === 'COMMIT') {
      opStyles = 'bg-emerald-500/15 border-emerald-500/40 text-emerald-100';
      opBadgeColor = 'text-emerald-400';
    } else if (blockData.op === 'ROLLBACK') {
      opStyles = 'bg-rose-500/15 border-rose-500/40 text-rose-100';
      opBadgeColor = 'text-rose-400';
    }

    blockDiv.className = `placed-block relative w-full h-full p-2 rounded-lg flex flex-col justify-between cursor-grab active:cursor-grabbing select-none border transition-all duration-200 shadow-sm ${opStyles}`;

    let bodyContent = '';
    if (blockData.op === 'READ') {
      bodyContent = `
        <div class="flex items-center gap-1 text-[11px] font-mono">
          <span class="text-slate-400">Acc:</span>
          <select class="inline-account-select bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-slate-200 focus:outline-none focus:border-sky-500">
            <option value="A" ${blockData.account === 'A' ? 'selected' : ''}>A</option>
            <option value="B" ${blockData.account === 'B' ? 'selected' : ''}>B</option>
            <option value="C" ${blockData.account === 'C' ? 'selected' : ''}>C</option>
          </select>
        </div>
      `;
    } else if (blockData.op === 'WRITE') {
      bodyContent = `
        <div class="flex items-center gap-1 text-[11px] font-mono">
          <select class="inline-account-select bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-slate-200 focus:outline-none focus:border-purple-500">
            <option value="A" ${blockData.account === 'A' ? 'selected' : ''}>A</option>
            <option value="B" ${blockData.account === 'B' ? 'selected' : ''}>B</option>
            <option value="C" ${blockData.account === 'C' ? 'selected' : ''}>C</option>
          </select>
          <input type="number" class="inline-amount-input w-14 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-slate-200 text-right focus:outline-none focus:border-purple-500" value="${blockData.amount || 200}" step="50" title="Amount delta">
        </div>
      `;
    } else if (blockData.op === 'COMMIT') {
      bodyContent = '<div class="text-[11px] font-mono font-bold text-emerald-400 text-center py-0.5">COMMIT</div>';
    } else if (blockData.op === 'ROLLBACK') {
      bodyContent = '<div class="text-[11px] font-mono font-bold text-rose-400 text-center py-0.5">ROLLBACK</div>';
    }

    blockDiv.innerHTML = `
      <div class="flex items-center justify-between">
        <span class="text-xs font-mono font-bold ${opBadgeColor}">${blockData.op}</span>
        <button type="button" class="placed-remove text-slate-400 hover:text-rose-400 font-bold text-sm leading-none transition" title="Remove">&times;</button>
      </div>
      <div class="my-1">${bodyContent}</div>
      <div class="text-[10px] font-mono text-slate-400 text-right">Step ${blockData.stepIndex}</div>
    `;

    // Listeners for inline account and amount variable changes
    const accSelect = blockDiv.querySelector('.inline-account-select');
    if (accSelect) {
      accSelect.addEventListener('change', (e) => {
        e.stopPropagation();
        blockDiv.dataset.account = accSelect.value;
        if (onScheduleChangeCallback) onScheduleChangeCallback();
      });
      accSelect.addEventListener('mousedown', (e) => e.stopPropagation());
    }

    const amtInput = blockDiv.querySelector('.inline-amount-input');
    if (amtInput) {
      amtInput.addEventListener('change', (e) => {
        e.stopPropagation();
        blockDiv.dataset.amount = parseFloat(amtInput.value) || 0;
        if (onScheduleChangeCallback) onScheduleChangeCallback();
      });
      amtInput.addEventListener('mousedown', (e) => e.stopPropagation());
    }

    // Remove button listener
    blockDiv.querySelector('.placed-remove').addEventListener('click', (e) => {
      e.stopPropagation();
      slotElement.innerHTML = '';
      if (onScheduleChangeCallback) onScheduleChangeCallback();
    });

    // Make placed block draggable to move it
    blockDiv.addEventListener('dragstart', (e) => {
      draggedData = {
        isNew: false,
        sourceTx: blockData.txId,
        sourceStep: blockData.stepIndex,
        op: blockData.op,
        account: blockData.account,
        amount: blockData.amount,
      };
      draggedBlockElement = blockDiv;
      droppedInValidSlot = false;
      e.dataTransfer.setData('text/plain', JSON.stringify(draggedData));
      e.dataTransfer.effectAllowed = 'move';
      blockDiv.classList.add('dragging');
    });

    blockDiv.addEventListener('dragend', handleDragEnd);

    slotElement.appendChild(blockDiv);
  }

  return {
    init,
    bindSlotEvents,
    placeBlockInSlot,
  };
})();

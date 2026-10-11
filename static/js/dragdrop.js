/**
 * Drag & Drop Module for goBankV2 Timeline Operations
 * Non-editable placed blocks with live DB amounts and smooth out-of-bounds deletion.
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
    this.classList.remove('opacity-50', 'ring-2', 'ring-sky-400', 'dragging');
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
    this.classList.remove('border-sky-400', 'bg-slate-800/90', 'scale-[1.02]');
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
      if (sourceSlot && sourceSlot !== this) {
        sourceSlot.innerHTML = '';
      }
    }

    // Place the block into this slot (non-editable with proper DB amounts)
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
    let opBadgeColor = 'text-sky-400 bg-sky-500/20';
    let detailsHtml = '';

    if (blockData.op === 'READ') {
      opStyles = 'bg-sky-500/15 border-sky-500/40 text-sky-100';
      opBadgeColor = 'text-sky-400 bg-sky-500/20';
      detailsHtml = `
        <div class="flex items-center gap-1.5 font-mono text-xs font-bold text-sky-300">
          <span>READ(${blockData.account})</span>
        </div>
        <span class="text-[10px] font-mono text-slate-400">SELECT balance</span>
      `;
    } else if (blockData.op === 'WRITE') {
      opStyles = 'bg-purple-500/15 border-purple-500/40 text-purple-100';
      opBadgeColor = 'text-purple-400 bg-purple-500/20';
      const sign = blockData.amount >= 0 ? '+' : '';
      detailsHtml = `
        <div class="flex items-center justify-between gap-1 font-mono text-xs font-bold text-purple-300">
          <span>WRITE(${blockData.account})</span>
          <span class="px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-200 text-[10px]">${sign}$${Math.abs(blockData.amount)}</span>
        </div>
        <span class="text-[10px] font-mono text-slate-400">UPDATE balance</span>
      `;
    } else if (blockData.op === 'COMMIT') {
      opStyles = 'bg-emerald-500/15 border-emerald-500/40 text-emerald-100';
      opBadgeColor = 'text-emerald-400 bg-emerald-500/20';
      detailsHtml = `
        <div class="font-mono text-xs font-bold text-emerald-300">COMMIT</div>
        <span class="text-[10px] font-mono text-emerald-400/80">Release Locks</span>
      `;
    } else if (blockData.op === 'ROLLBACK') {
      opStyles = 'bg-rose-500/15 border-rose-500/40 text-rose-100';
      opBadgeColor = 'text-rose-400 bg-rose-500/20';
      detailsHtml = `
        <div class="font-mono text-xs font-bold text-rose-300">ROLLBACK</div>
        <span class="text-[10px] font-mono text-rose-400/80">Abort & Undo</span>
      `;
    }

    blockDiv.className = `placed-block relative w-full h-full p-2 rounded-xl flex items-center justify-between gap-2 cursor-grab active:cursor-grabbing select-none border transition-all duration-200 shadow-sm ${opStyles}`;

    blockDiv.innerHTML = `
      <div class="flex items-center gap-2 min-w-0">
        <div class="w-6 h-6 rounded-md ${opBadgeColor} font-mono font-bold flex items-center justify-center text-[10px] flex-shrink-0">
          ${blockData.op === 'READ' ? 'R' : blockData.op === 'WRITE' ? 'W' : blockData.op === 'COMMIT' ? 'C' : 'AB'}
        </div>
        <div class="flex flex-col min-w-0 leading-tight">
          ${detailsHtml}
        </div>
      </div>
      <button type="button" class="placed-remove text-slate-400 hover:text-rose-400 font-bold text-base leading-none p-1 rounded hover:bg-slate-800/60 transition flex-shrink-0" title="Remove block">&times;</button>
    `;

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
      blockDiv.classList.add('opacity-50', 'ring-2', 'ring-sky-400');
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

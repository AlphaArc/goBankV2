/**
 * Drag & Drop Module for goBankV2 Timeline Operations
 */

window.DragDropModule = (function () {
  let draggedData = null;
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

    e.dataTransfer.setData('text/plain', JSON.stringify(draggedData));
    e.dataTransfer.effectAllowed = 'copy';
    this.classList.add('dragging');
  }

  function handleDragEnd() {
    this.classList.remove('dragging');
    document.querySelectorAll('.timeline-slot').forEach(slot => {
      slot.classList.remove('drag-over');
    });
    draggedData = null;
  }

  function bindSlotEvents(slotElement) {
    slotElement.addEventListener('dragover', handleSlotDragOver);
    slotElement.addEventListener('dragleave', handleSlotDragLeave);
    slotElement.addEventListener('drop', handleSlotDrop);
  }

  function handleSlotDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    this.classList.add('drag-over');
  }

  function handleSlotDragLeave() {
    this.classList.remove('drag-over');
  }

  function handleSlotDrop(e) {
    e.preventDefault();
    this.classList.remove('drag-over');

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
    blockDiv.className = `placed-block op-${blockData.op}`;
    blockDiv.setAttribute('draggable', 'true');
    blockDiv.dataset.tx = blockData.txId;
    blockDiv.dataset.step = blockData.stepIndex;
    blockDiv.dataset.op = blockData.op;
    blockDiv.dataset.account = blockData.account;
    blockDiv.dataset.amount = blockData.amount || 0;

    let opLabel = blockData.op;
    let detailText = '';
    if (blockData.op === 'READ') {
      detailText = `Acc ${blockData.account}`;
    } else if (blockData.op === 'WRITE') {
      const sign = (blockData.amount >= 0) ? '+' : '';
      detailText = `Acc ${blockData.account} (${sign}$${blockData.amount})`;
    } else if (blockData.op === 'COMMIT') {
      detailText = 'Commit Tx';
    } else if (blockData.op === 'ROLLBACK') {
      detailText = 'Rollback';
    }

    blockDiv.innerHTML = `
      <div class="placed-header">
        <span class="placed-type">${opLabel}</span>
        <button class="placed-remove" title="Remove">&times;</button>
      </div>
      <div class="placed-body">${detailText}</div>
      <div class="placed-footer">Step ${blockData.stepIndex}</div>
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

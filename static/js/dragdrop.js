/**
 * dragdrop.js - HTML5 Drag & Drop & Touch Controller for goBankV2
 *
 * Responsibilities (Section 4.3):
 * - Starts drags from palette blocks (READ, WRITE, COMMIT, ROLLBACK).
 * - Highlights valid slots (and marks invalid slots).
 * - Enforces slot boundaries and canPlace validation.
 * - Captures target account and delta from palette at drop time.
 * - Reordering between slots.
 * - Animated delete when a block is dropped outside the matrix.
 * - Touch fallback: tap a palette block, then tap a slot (Section 4.4).
 * - Disables DnD during BUSY mode (Section 4.6).
 * - NEVER touches schedule state directly; calls callbacks into app.js.
 */

window.DragDropModule = (function () {
  let callbacks = {
    onPlace: null,
    onMove: null,
    onRemove: null,
    canPlace: null,
    showToast: null,
    isBusy: () => false,
  };

  let draggedPaletteOp = null;
  let draggedPlacedBlock = null;
  let droppedInValidSlot = false;
  let touchSelectedOp = null;

  function init(cb) {
    callbacks = { ...callbacks, ...cb };
    setupPalette();
  }

  function setupPalette() {
    const paletteBlocks = document.querySelectorAll('.palette-block');
    paletteBlocks.forEach(block => {
      // HTML5 Drag Events
      block.addEventListener('dragstart', handlePaletteDragStart);
      block.addEventListener('dragend', handlePaletteDragEnd);

      // Touch / Tap Fallback
      block.addEventListener('click', handlePaletteClick);
    });
  }

  function handlePaletteDragStart(e) {
    if (callbacks.isBusy && callbacks.isBusy()) {
      e.preventDefault();
      return;
    }

    const op = this.getAttribute('data-op');
    draggedPaletteOp = op;
    draggedPlacedBlock = null;
    droppedInValidSlot = false;

    // Clear any active touch selection
    clearTouchSelection();

    const transferData = {
      isPalette: true,
      op: op,
    };
    e.dataTransfer.setData('text/plain', JSON.stringify(transferData));
    e.dataTransfer.effectAllowed = 'copy';
    this.classList.add('opacity-50', 'ring-2', 'ring-sky-400');
  }

  function handlePaletteDragEnd() {
    this.classList.remove('opacity-50', 'ring-2', 'ring-sky-400');
    clearSlotHighlights();
    draggedPaletteOp = null;
    draggedPlacedBlock = null;
    droppedInValidSlot = false;
  }

  function handlePaletteClick() {
    if (callbacks.isBusy && callbacks.isBusy()) return;

    const op = this.getAttribute('data-op');
    if (touchSelectedOp === op) {
      clearTouchSelection();
      if (callbacks.showToast) callbacks.showToast('Block deselected.', 'info');
    } else {
      clearTouchSelection();
      touchSelectedOp = op;
      this.classList.add('touch-selected');
      if (callbacks.showToast) {
        callbacks.showToast(`Selected ${op}. Tap an empty step slot to place.`, 'info');
      }
    }
  }

  function clearTouchSelection() {
    touchSelectedOp = null;
    document.querySelectorAll('.palette-block').forEach(b => {
      b.classList.remove('touch-selected');
    });
  }

  function clearSlotHighlights() {
    document.querySelectorAll('.timeline-slot').forEach(slot => {
      slot.classList.remove('slot-drop-valid', 'slot-drop-invalid', 'border-sky-400', 'bg-slate-800/90');
    });
  }

  function bindSlot(slotEl) {
    slotEl.addEventListener('dragover', handleSlotDragOver);
    slotEl.addEventListener('dragenter', handleSlotDragEnter);
    slotEl.addEventListener('dragleave', handleSlotDragLeave);
    slotEl.addEventListener('drop', handleSlotDrop);
    slotEl.addEventListener('click', handleSlotClick);
  }

  function handleSlotDragOver(e) {
    if (callbacks.isBusy && callbacks.isBusy()) {
      e.dataTransfer.dropEffect = 'none';
      return;
    }
    e.preventDefault();

    const targetTx = this.getAttribute('data-tx');
    const targetStep = parseInt(this.getAttribute('data-step'), 10);
    const movingId = draggedPlacedBlock ? draggedPlacedBlock.id : null;
    const op = draggedPlacedBlock ? draggedPlacedBlock.op : draggedPaletteOp;

    const check = callbacks.canPlace ? callbacks.canPlace(targetTx, targetStep, movingId, op) : { allowed: true };
    if (check.allowed) {
      e.dataTransfer.dropEffect = draggedPlacedBlock ? 'move' : 'copy';
      this.classList.add('slot-drop-valid');
      this.classList.remove('slot-drop-invalid');
    } else {
      e.dataTransfer.dropEffect = 'none';
      this.classList.add('slot-drop-invalid');
      this.classList.remove('slot-drop-valid');
    }
  }

  function handleSlotDragEnter(e) {
    e.preventDefault();
  }

  function handleSlotDragLeave() {
    this.classList.remove('slot-drop-valid', 'slot-drop-invalid');
  }

  function handleSlotDrop(e) {
    e.preventDefault();
    this.classList.remove('slot-drop-valid', 'slot-drop-invalid');

    if (callbacks.isBusy && callbacks.isBusy()) return;

    const targetTx = this.getAttribute('data-tx');
    const targetStep = parseInt(this.getAttribute('data-step'), 10);

    let payload = null;
    try {
      const raw = e.dataTransfer.getData('text/plain');
      if (raw) payload = JSON.parse(raw);
    } catch (err) {
      // ignore JSON parse error
    }

    const movingId = draggedPlacedBlock ? draggedPlacedBlock.id : null;
    const op = draggedPlacedBlock ? draggedPlacedBlock.op : (payload ? payload.op : draggedPaletteOp);

    // Validate placement
    const check = callbacks.canPlace ? callbacks.canPlace(targetTx, targetStep, movingId, op) : { allowed: true };
    if (!check.allowed) {
      if (callbacks.showToast) {
        callbacks.showToast(check.reason || 'Cannot place operation here.', 'warning');
      }
      return;
    }

    droppedInValidSlot = true;

    if (draggedPlacedBlock) {
      // Reordering an existing block
      const sourceId = draggedPlacedBlock.id;
      if (callbacks.onMove) {
        callbacks.onMove(sourceId, targetTx, targetStep);
      }
    } else if (op) {
      // Dropping a new block from the palette
      const accountEl = document.getElementById('paletteAccount');
      const deltaEl = document.getElementById('paletteDelta');
      const account = (op === 'COMMIT' || op === 'ROLLBACK') ? 'ALL' : (accountEl ? accountEl.value : 'A');
      const delta = (op === 'WRITE') ? (parseFloat(deltaEl ? deltaEl.value : 200) || 200) : 0;

      if (callbacks.onPlace) {
        callbacks.onPlace(targetTx, targetStep, op, account, delta);
      }
    }
  }

  function handleSlotClick() {
    if (callbacks.isBusy && callbacks.isBusy()) return;
    if (!touchSelectedOp) return;

    const targetTx = this.getAttribute('data-tx');
    const targetStep = parseInt(this.getAttribute('data-step'), 10);

    const check = callbacks.canPlace ? callbacks.canPlace(targetTx, targetStep, null, touchSelectedOp) : { allowed: true };
    if (!check.allowed) {
      if (callbacks.showToast) {
        callbacks.showToast(check.reason || 'Cannot place operation here.', 'warning');
      }
      return;
    }

    const accountEl = document.getElementById('paletteAccount');
    const deltaEl = document.getElementById('paletteDelta');
    const op = touchSelectedOp;
    const account = (op === 'COMMIT' || op === 'ROLLBACK') ? 'ALL' : (accountEl ? accountEl.value : 'A');
    const delta = (op === 'WRITE') ? (parseFloat(deltaEl ? deltaEl.value : 200) || 200) : 0;

    clearTouchSelection();

    if (callbacks.onPlace) {
      callbacks.onPlace(targetTx, targetStep, op, account, delta);
    }
  }

  function bindPlacedBlock(blockEl, blockData) {
    blockEl.setAttribute('draggable', 'true');

    blockEl.addEventListener('dragstart', (e) => {
      if (callbacks.isBusy && callbacks.isBusy()) {
        e.preventDefault();
        return;
      }

      draggedPlacedBlock = { ...blockData };
      draggedPaletteOp = null;
      droppedInValidSlot = false;
      clearTouchSelection();

      e.dataTransfer.setData('text/plain', JSON.stringify({
        isPalette: false,
        id: blockData.id,
        tx: blockData.tx,
        step: blockData.step,
        op: blockData.op,
      }));
      e.dataTransfer.effectAllowed = 'move';
      blockEl.classList.add('opacity-50', 'ring-2', 'ring-sky-400');
    });

    blockEl.addEventListener('dragend', () => {
      blockEl.classList.remove('opacity-50', 'ring-2', 'ring-sky-400');
      clearSlotHighlights();

      // Out-of-bounds deletion check: dropped outside matrix
      if (draggedPlacedBlock && !droppedInValidSlot) {
        const idToDelete = draggedPlacedBlock.id;
        blockEl.classList.add('transition-opacity', 'duration-300', 'opacity-0', 'scale-75', '-translate-y-2');
        setTimeout(() => {
          if (callbacks.onRemove) {
            callbacks.onRemove(idToDelete);
          }
        }, 300);
      }

      draggedPlacedBlock = null;
      draggedPaletteOp = null;
      droppedInValidSlot = false;
    });
  }

  function setDisabled(disabled) {
    const paletteBlocks = document.querySelectorAll('.palette-block');
    paletteBlocks.forEach(b => {
      b.setAttribute('draggable', !disabled);
      if (disabled) b.classList.add('cursor-not-allowed', 'opacity-50');
      else b.classList.remove('cursor-not-allowed', 'opacity-50');
    });

    const placedBlocks = document.querySelectorAll('.placed-block');
    placedBlocks.forEach(b => {
      b.setAttribute('draggable', !disabled);
      if (disabled) b.classList.add('cursor-not-allowed');
      else b.classList.remove('cursor-not-allowed');
    });
  }

  return {
    init,
    bindSlot,
    bindPlacedBlock,
    clearTouchSelection,
    setDisabled,
  };
})();

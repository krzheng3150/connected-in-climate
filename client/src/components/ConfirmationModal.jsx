import { useEffect, useRef } from 'react'

export default function ConfirmationModal({ title, children, confirmLabel = 'Confirm', cancelLabel = 'Cancel', onConfirm, onCancel, confirming = false }) {
  const overlayRef = useRef(null)

  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onCancel])

  function handleOverlayClick(e) {
    if (e.target === overlayRef.current) onCancel()
  }

  return (
    <div className="modal-overlay" ref={overlayRef} onClick={handleOverlayClick}>
      <div className="modal-card">
        <h2 className="modal-title">{title}</h2>
        <div className="modal-body">{children}</div>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onCancel} disabled={confirming}>{cancelLabel}</button>
          <button className="btn-primary" onClick={onConfirm} disabled={confirming}>
            {confirming ? 'Processing...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

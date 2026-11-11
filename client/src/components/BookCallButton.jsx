export default function BookCallButton({ link, label = 'Book Call', variant = 'btn-secondary', onClick }) {
  if (link) {
    return (
      <a
        className={variant}
        href={link}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onClick}
        style={{ display: 'inline-block', textDecoration: 'none' }}
      >
        {label}
      </a>
    )
  }
  return (
    <span className="tooltip-wrap">
      <button className={variant} disabled>{label}</button>
      <span className="tooltip-text">Mentor has not set up a scheduling link. Please reach out to mentor directly.</span>
    </span>
  )
}

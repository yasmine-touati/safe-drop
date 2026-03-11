import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { decryptFile } from './utils/crypto'

function getKeyFromHash() {
  const hash = window.location.hash || ''
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  const params = new URLSearchParams(raw)
  return params.get('key') || ''
}

function extractFilename(contentDisposition, fallback = 'shared-file.bin') {
  if (!contentDisposition) return fallback
  const match = contentDisposition.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i)
  const encoded = match?.[1] || match?.[2]
  if (!encoded) return fallback
  try {
    return decodeURIComponent(encoded)
  } catch {
    return encoded
  }
}

export default function SharePage() {
  const { token } = useParams()
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const keyFromUrl = useMemo(() => getKeyFromHash(), [])

  async function handleDownload() {
    if (!token) return
    setDownloading(true)
    setError('')
    setDone(false)

    try {
      const res = await fetch(`/api/files/share/${token}`)
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        throw new Error(payload.error || 'Failed to fetch shared file')
      }

      const iv = res.headers.get('X-Encryption-IV')
      const filename = extractFilename(res.headers.get('Content-Disposition'))
      const raw = await res.arrayBuffer()

      let blob
      if (iv) {
        if (!keyFromUrl) {
          throw new Error('This file is encrypted. Missing key in URL hash (#key=...).')
        }
        if (!window.isSecureContext || !crypto.subtle) {
          throw new Error('Secure context required for decryption. Open via HTTPS.')
        }
        const decrypted = await decryptFile(raw, keyFromUrl, iv)
        blob = new Blob([decrypted])
      } else {
        blob = new Blob([raw])
      }

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
      setDone(true)
    } catch (e) {
      setError(e.message || 'Download failed')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-logo">safe<span>/drop</span></div>
        <p className="auth-subtitle">Shared file access</p>

        <button className="btn-primary" onClick={handleDownload} disabled={downloading}>
          {downloading ? 'Downloading...' : 'Download shared file'}
        </button>

        {error && <div className="error-msg" style={{ marginTop: '1rem' }}>{error}</div>}
        {done && <div style={{ marginTop: '1rem', color: 'var(--green)', fontSize: '0.8rem' }}>Download started.</div>}

        <div className="auth-switch" style={{ marginTop: '1rem' }}>
          Have an account?
          <Link to="/login">Login</Link>
        </div>
      </div>
    </div>
  )
}

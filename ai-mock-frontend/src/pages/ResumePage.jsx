import { FileText, UploadCloud } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { fetchMyResume, uploadResume } from '../api/interviews';

const MAX_FILE_SIZE = 5 * 1024 * 1024;

export default function ResumePage() {
  const inputRef = useRef(null);
  const [resume, setResume] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return undefined;
    loadedRef.current = true;
    fetchMyResume()
      .then(setResume)
      .catch((err) => setError(err.message || 'Unable to load resume.'))
      .finally(() => setLoading(false));
    return undefined;
  }, []);

  function chooseFile(event) {
    const file = event.target.files?.[0];
    setError('');
    setSelectedFile(null);
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setError('Please choose a PDF resume.');
      return;
    }
    if (file.type && file.type !== 'application/pdf') {
      setError('The selected file is not a PDF.');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError('PDF resumes must be 5 MB or smaller.');
      return;
    }
    setSelectedFile(file);
  }

  async function handleUpload(event) {
    event.preventDefault();
    if (!selectedFile) {
      setError('Choose a PDF before uploading.');
      return;
    }
    setUploading(true);
    setError('');
    try {
      setResume(await uploadResume(selectedFile));
      setSelectedFile(null);
      if (inputRef.current) inputRef.current.value = '';
    } catch (err) {
      setError(err.message || 'Unable to upload and extract this resume.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="page-stack narrow-page">
      <header className="panel hero-panel">
        <div>
          <p className="eyebrow">Candidate file</p>
          <h2>Your resume</h2>
          <p>Keep one private PDF on file for grounded interview questions.</p>
        </div>
        <FileText size={42} strokeWidth={1.2} aria-hidden="true" />
      </header>

      <form className="panel upload-panel" onSubmit={handleUpload}>
        <div className="upload-dropzone">
          <UploadCloud size={28} aria-hidden="true" />
          <div>
            <strong>Upload a PDF resume</strong>
            <p>Private storage · maximum 5 MB · text extraction is validated on the server.</p>
          </div>
          <label className="file-input-label" htmlFor="resume-file">Choose file</label>
          <input ref={inputRef} id="resume-file" type="file" accept="application/pdf,.pdf" onChange={chooseFile} />
        </div>
        {selectedFile && <p className="file-selected">Ready: {selectedFile.name}</p>}
        {error && <p className="error-text" role="alert">{error}</p>}
        <button type="submit" className="primary-button" disabled={uploading || loading}>
          {uploading ? 'Uploading and extracting…' : 'Upload resume'}
        </button>
      </form>

      {loading ? (
        <div className="panel empty-state">Checking your private resume…</div>
      ) : resume ? (
        <section className="panel resume-record" aria-live="polite">
          <div className="resume-record-icon"><FileText size={22} /></div>
          <div>
            <p className="eyebrow">Current resume</p>
            <h3>{resume.original_filename}</h3>
            <p>{Math.round(resume.file_size_bytes / 1024)} KB · {resume.content_type}</p>
            <span className="status-badge success">
              {resume.processing_status === 'processed' ? 'Text extraction succeeded' : resume.processing_status}
            </span>
          </div>
        </section>
      ) : (
        <div className="panel empty-state">No resume uploaded yet. Add one to personalize your interview.</div>
      )}
    </div>
  );
}

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ResumePage from './ResumePage';

vi.mock('../api/interviews', () => ({
  fetchMyResume: vi.fn(),
  uploadResume: vi.fn(),
}));

import { fetchMyResume, uploadResume } from '../api/interviews';

describe('ResumePage', () => {
  beforeEach(() => {
    fetchMyResume.mockRejectedValue(new Error('Resume not found'));
    uploadResume.mockResolvedValue({
      original_filename: 'resume.pdf',
      content_type: 'application/pdf',
      file_size_bytes: 2048,
      processing_status: 'processed',
    });
  });

  it('rejects non-PDF files before upload', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ResumePage /></MemoryRouter>);
    const file = new File(['not a pdf'], 'notes.txt', { type: 'text/plain' });

    fireEvent.change(await screen.findByLabelText(/choose file/i), { target: { files: [file] } });

    expect(await screen.findByRole('alert')).toHaveTextContent(/choose a pdf/i);
    expect(uploadResume).not.toHaveBeenCalled();
  });

  it('uploads a PDF and shows extraction status', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ResumePage /></MemoryRouter>);
    const file = new File(['%PDF-1.7'], 'resume.pdf', { type: 'application/pdf' });

    await user.upload(await screen.findByLabelText(/choose file/i), file);
    await user.click(screen.getByRole('button', { name: /upload resume/i }));

    await waitFor(() => expect(uploadResume).toHaveBeenCalledWith(file));
    expect(await screen.findByText(/text extraction succeeded/i)).toBeInTheDocument();
  });
});

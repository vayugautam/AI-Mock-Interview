import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import AuthPage from './AuthPage';
import { AuthProvider } from '../context/AuthContext';

vi.mock('../api/auth', () => ({
  fetchCurrentUser: vi.fn(),
  loginUser: vi.fn(),
  registerUser: vi.fn(),
}));

describe('AuthPage', () => {
  it('validates required fields before submitting', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AuthProvider>
          <AuthPage mode="login" />
        </AuthProvider>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: /sign in/i }));
    expect(screen.getByText(/email and password are required/i)).toBeInTheDocument();
  });
});

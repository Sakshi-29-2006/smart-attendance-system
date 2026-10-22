import { useState } from "react";
import axios from "axios";

const API_URL = "http://localhost:5000/api/auth";

export default function Login({ onLogin, onShowSignup }) {
    const [prn, setPrn] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    async function handleSubmit(event) {
        event.preventDefault();
        setError("");
        setLoading(true);

        try {
            const response = await axios.post(`${API_URL}/login`, {
                prn,
                password,
            });

            onLogin(response.data);
        } catch (err) {
            setError(
                err.response?.data?.message ||
                "Login failed. Check your PRN and password."
            );
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="auth-container">
            <form className="auth-card" onSubmit={handleSubmit}>
                <h1>Student Login</h1>
                <p>Sign in to your Smart Attendance account.</p>

                <label htmlFor="login-prn">12-digit PRN</label>
                <input
                    id="login-prn"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]{12}"
                    maxLength={12}
                    value={prn}
                    onChange={(event) => setPrn(event.target.value)}
                    placeholder="Enter your PRN"
                    required
                />

                <label htmlFor="login-password">Password</label>
                <input
                    id="login-password"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    required
                />

                {error && <p className="auth-error">{error}</p>}

                <button type="submit" disabled={loading}>
                    {loading ? "Signing in..." : "Login"}
                </button>

                <p>
                    Don't have an account?{" "}
                    <button
                        type="button"
                        className="auth-link"
                        onClick={onShowSignup}
                    >
                        Sign up
                    </button>
                </p>
            </form>
        </div>
    );
}

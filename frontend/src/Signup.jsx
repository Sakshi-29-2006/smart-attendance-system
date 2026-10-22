import { useState } from "react";
import axios from "axios";

const API_URL = `${import.meta.env.VITE_API_URL || "http://localhost:5000/api"}/auth`;

export default function Signup({ onShowLogin }) {
    const [form, setForm] = useState({
        prn: "",
        full_name: "",
        branch: "",
        academic_year: "",
        password: "",
        confirmPassword: "",
    });

    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const [loading, setLoading] = useState(false);

    function handleChange(event) {
        const { name, value } = event.target;

        setForm((previous) => ({
            ...previous,
            [name]: value,
        }));
    }

    async function handleSubmit(event) {
        event.preventDefault();
        setError("");
        setSuccess("");

        if (!/^[0-9]{12}$/.test(form.prn)) {
            setError("PRN must contain exactly 12 digits.");
            return;
        }

        if (form.password.length < 12 || form.password.length > 128) {
            setError("Password must be 12–128 characters long.");
            return;
        }

        if (form.password !== form.confirmPassword) {
            setError("Passwords do not match.");
            return;
        }

        setLoading(true);

        try {
            await axios.post(`${API_URL}/signup`, {
                prn: form.prn,
                full_name: form.full_name.trim(),
                branch: form.branch,
                academic_year: form.academic_year,
                password: form.password,
            });

            setSuccess("Account created successfully! You can now log in.");

            setForm({
                prn: "",
                full_name: "",
                branch: "",
                academic_year: "",
                password: "",
                confirmPassword: "",
            });
        } catch (err) {
            setError(
                err.response?.data?.message ||
                "Sign-up failed. Please check your details and try again."
            );
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="auth-container">
            <form className="auth-card" onSubmit={handleSubmit}>
                <h1>Student Sign Up</h1>
                <p>Create your Smart Attendance account.</p>

                <label htmlFor="signup-prn">12-digit PRN</label>
                <input
                    id="signup-prn"
                    name="prn"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]{12}"
                    maxLength={12}
                    value={form.prn}
                    onChange={handleChange}
                    placeholder="Enter your PRN"
                    required
                />

                <label htmlFor="signup-name">Full Name</label>
                <input
                    id="signup-name"
                    name="full_name"
                    type="text"
                    maxLength={150}
                    value={form.full_name}
                    onChange={handleChange}
                    placeholder="Enter your full name"
                    autoComplete="name"
                    required
                />

                <label htmlFor="signup-branch">Branch</label>
                <input
                    id="signup-branch"
                    name="branch"
                    type="text"
                    maxLength={100}
                    value={form.branch}
                    onChange={handleChange}
                    placeholder="e.g. CSE"
                    required
                />

                <label htmlFor="signup-year">Academic Year</label>
                <select
                    id="signup-year"
                    name="academic_year"
                    value={form.academic_year}
                    onChange={handleChange}
                    required
                >
                    <option value="">Select academic year</option>
                    <option value="First Year">First Year</option>
                    <option value="Second Year">Second Year</option>
                    <option value="Third Year">Third Year</option>
                    <option value="Fourth Year">Fourth Year</option>
                </select>

                <label htmlFor="signup-password">Password</label>
                <input
                    id="signup-password"
                    name="password"
                    type="password"
                    minLength={12}
                    maxLength={128}
                    value={form.password}
                    onChange={handleChange}
                    placeholder="At least 12 characters"
                    autoComplete="new-password"
                    required
                />

                <label htmlFor="signup-confirm">Confirm Password</label>
                <input
                    id="signup-confirm"
                    name="confirmPassword"
                    type="password"
                    minLength={12}
                    maxLength={128}
                    value={form.confirmPassword}
                    onChange={handleChange}
                    placeholder="Re-enter your password"
                    autoComplete="new-password"
                    required
                />

                {error && <p className="auth-error">{error}</p>}
                {success && <p className="auth-success">{success}</p>}

                <button type="submit" disabled={loading}>
                    {loading ? "Creating account..." : "Create Account"}
                </button>

                <p>
                    Already have an account?{" "}
                    <button
                        type="button"
                        className="auth-link"
                        onClick={onShowLogin}
                    >
                        Login
                    </button>
                </p>
            </form>
        </div>
    );
}

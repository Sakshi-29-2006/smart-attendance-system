
import { useState } from "react";
import "./App.css";

import TeacherAttendance from "./TeacherAttendance";
import StudentRegistration from "./StudentRegistration";
import StudentDashboard from "./StudentDashboard";
import Login from "./Login";
import Signup from "./Signup";

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:5000/api");

function App() {
    const [dashboard, setDashboard] = useState("home");
    const [auth, setAuth] = useState(null);
    const [loginRole, setLoginRole] = useState("student");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    function openDashboard(role) {
        setError("");

        if (auth?.role === role) {
            setDashboard(role);
        } else {
            setLoginRole(role);
            setDashboard("login");
        }
    }

    function handleStudentLogin(data) {
        setAuth({
            role: "student",
            token: data.access_token,
            profile: data.student,
        });

        setDashboard("student");
        setError("");
    }

    async function handleTeacherLogin(event) {
        event.preventDefault();
        setError("");
        setLoading(true);

        const form = new FormData(event.currentTarget);

        try {
            const response = await fetch(
                `${API_URL}/auth/teacher/login`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        username: form.get("username"),
                        password: form.get("password"),
                    }),
                }
            );

            const data = await response.json();

            if (
                !response.ok ||
                !data.success ||
                !data.access_token
            ) {
                throw new Error(
                    data.message || "Teacher login failed."
                );
            }

            setAuth({
                role: "teacher",
                token: data.access_token,
                profile: data.teacher,
            });

            setDashboard("teacher");
            setError("");
        } catch (err) {
            setError(
                err.message || "Unable to connect to the server."
            );
        } finally {
            setLoading(false);
        }
    }

    function logout() {
        setAuth(null);
        setDashboard("home");
        setLoginRole("student");
        setError("");
    }

    function showStudentSignup() {
        setError("");
        setDashboard("signup");
    }

    function showStudentLogin() {
        setError("");
        setLoginRole("student");
        setDashboard("login");
    }

    return (
        <div className="app">
            <nav className="app-navbar">
                <div className="app-title">
                    Smart Attendance System
                </div>

                <div className="app-navigation">
                    <button
                        className={
                            dashboard === "home"
                                ? "nav-button active"
                                : "nav-button"
                        }
                        onClick={() => setDashboard("home")}
                    >
                        Home
                    </button>

                    <button
                        className={
                            dashboard === "student" ||
                            dashboard === "registration"
                                ? "nav-button active"
                                : "nav-button"
                        }
                        onClick={() => openDashboard("student")}
                    >
                        Student Dashboard
                    </button>

                    <button
                        className={
                            dashboard === "teacher"
                                ? "nav-button active"
                                : "nav-button"
                        }
                        onClick={() => openDashboard("teacher")}
                    >
                        Teacher Dashboard
                    </button>

                    {auth && (
                        <button
                            className="nav-button"
                            onClick={logout}
                        >
                            Logout
                        </button>
                    )}
                </div>
            </nav>

            {dashboard === "home" && (
                <div className="dashboard-selection">
                    <h1>Smart Attendance System</h1>
                    <p>Select a dashboard to continue</p>

                    <div className="dashboard-options">
                        <button
                            onClick={() => openDashboard("student")}
                        >
                            Student Dashboard
                        </button>

                        <button
                            onClick={() => openDashboard("teacher")}
                        >
                            Teacher Dashboard
                        </button>
                    </div>
                </div>
            )}

            {dashboard === "login" &&
                loginRole === "student" && (
                    <Login
                        onLogin={handleStudentLogin}
                        onShowSignup={showStudentSignup}
                    />
                )}

            {dashboard === "login" &&
                loginRole === "teacher" && (
                    <div className="auth-container">
                        <form
                            className="auth-card"
                            onSubmit={handleTeacherLogin}
                        >
                            <h1>Teacher Login</h1>

                            <p>
                                Sign in to access the Teacher Dashboard.
                            </p>

                            <label htmlFor="teacher-username">
                                Username
                            </label>

                            <input
                                id="teacher-username"
                                name="username"
                                type="text"
                                autoComplete="username"
                                maxLength={100}
                                required
                            />

                            <label htmlFor="teacher-password">
                                Password
                            </label>

                            <input
                                id="teacher-password"
                                name="password"
                                type="password"
                                autoComplete="current-password"
                                maxLength={128}
                                required
                            />

                            {error && (
                                <p className="auth-error" role="alert">
                                    {error}
                                </p>
                            )}

                            <button type="submit" disabled={loading}>
                                {loading ? "Signing in..." : "Login"}
                            </button>
                        </form>
                    </div>
                )}

            {dashboard === "signup" && (
                <Signup onShowLogin={showStudentLogin} />
            )}

            {dashboard === "student" &&
                auth?.role === "student" && (
                    <StudentDashboard
                        token={auth.token}
                        profile={auth.profile}
                        onOpenRegistration={() =>
                            setDashboard("registration")
                        }
                    />
                )}

            {dashboard === "registration" &&
                auth?.role === "student" && (
                    <div>
                        <div className="student-registration-toolbar">
                            <button
                                type="button"
                                onClick={() => setDashboard("student")}
                            >
                                ← Back to Attendance Dashboard
                            </button>
                        </div>

                        <StudentRegistration token={auth.token} />
                    </div>
                )}

            {dashboard === "teacher" &&
                auth?.role === "teacher" && (
                    <TeacherAttendance token={auth.token} />
                )}
        </div>
    );
}

export default App;

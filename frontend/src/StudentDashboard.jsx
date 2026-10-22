
import { useCallback, useEffect, useState } from "react";

const API_URL = "http://localhost:5000/api";

function formatDate(value) {
    if (!value) return "Date unavailable";

    const date = new Date(`${value}`.slice(0, 10) + "T00:00:00");

    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
    });
}

function formatTime(value) {
    if (!value) return "";

    const parts = String(value).split(":");
    if (parts.length < 2) return value;

    const hours = Number(parts[0]);
    const minutes = Number(parts[1]);

    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
        return value;
    }

    const date = new Date();
    date.setHours(hours, minutes, 0, 0);

    return date.toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
    });
}

function StudentDashboard({ token, profile, onOpenRegistration }) {
    const [attendance, setAttendance] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [refreshing, setRefreshing] = useState(false);

    const loadAttendance = useCallback(async (isRefresh = false) => {
        if (!token) {
            setAttendance([]);
            setError("Please log in again to view your attendance.");
            setLoading(false);
            return;
        }

        if (isRefresh) {
            setRefreshing(true);
        } else {
            setLoading(true);
        }

        setError("");

        try {
            const response = await fetch(
                `${API_URL}/attendance/my-attendance`,
                {
                    method: "GET",
                    headers: {
                        Authorization: `Bearer ${token}`,
                        Accept: "application/json",
                    },
                }
            );

            const data = await response.json().catch(() => ({}));

            if (response.status === 401 || response.status === 403) {
                throw new Error(
                    "Your login may have expired. Please log out and log in again."
                );
            }

            if (!response.ok || !data.success) {
                throw new Error(
                    data.message || "Unable to load attendance records."
                );
            }

            setAttendance(
                Array.isArray(data.attendance) ? data.attendance : []
            );
        } catch (err) {
            setError(
                err.message || "Could not connect to the attendance server."
            );
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [token]);

    useEffect(() => {
        loadAttendance();
    }, [loadAttendance]);

    const records = attendance.map((record, index) => {
        const session = record.attendance_sessions || {};

        return {
            id: `${session.id || "session"}-${index}`,
            subject: session.subject_name || "Unnamed subject",
            batch: session.batch_name || "",
            date: session.class_date || "",
            startTime: session.start_time || "",
            endTime: session.end_time || "",
            status: String(record.status || "").toLowerCase(),
            markedAt: record.marked_at || "",
        };
    });

    const presentCount = records.filter(
        (record) => record.status === "present"
    ).length;

    const absentCount = records.filter(
        (record) => record.status === "absent"
    ).length;

    const otherCount = records.length - presentCount - absentCount;

    const attendancePercentage =
        records.length > 0
            ? Math.round((presentCount / records.length) * 100)
            : 0;

    const sortedRecords = [...records].sort((a, b) => {
        const dateCompare = (b.date || "").localeCompare(a.date || "");
        if (dateCompare !== 0) return dateCompare;

        return (b.startTime || "").localeCompare(a.startTime || "");
    });

    return (
        <main className="student-dashboard-page">
            <section className="student-dashboard-container">
                <header className="student-dashboard-header">
                    <div>
                        <p className="student-dashboard-eyebrow">
                            STUDENT PORTAL
                        </p>

                        <h1>
                            Welcome
                            {profile?.full_name
                                ? `, ${profile.full_name}`
                                : ""}
                        </h1>

                        <p className="student-dashboard-subtitle">
                            View your class attendance and attendance status.
                        </p>
                    </div>

                    <button
                        type="button"
                        className="student-refresh-button"
                        onClick={() => loadAttendance(true)}
                        disabled={loading || refreshing}
                    >
                        {refreshing ? "Refreshing..." : "Refresh attendance"}
                    </button>
                </header>

                <section className="student-profile-card">
                    <div className="student-profile-avatar" aria-hidden="true">
                        {(profile?.full_name || "S")
                            .trim()
                            .charAt(0)
                            .toUpperCase()}
                    </div>

                    <div className="student-profile-details">
                        <h2>{profile?.full_name || "Student"}</h2>

                        <p>
                            <strong>PRN:</strong>{" "}
                            {profile?.prn || "Not available"}
                        </p>

                        <p>
                            <strong>Branch:</strong>{" "}
                            {profile?.branch || "Not available"}
                        </p>

                        <p>
                            <strong>Academic year:</strong>{" "}
                            {profile?.academic_year || "Not available"}
                        </p>
                    </div>
                </section>

                {error && (
                    <div className="student-dashboard-error" role="alert">
                        <p>{error}</p>
                        <button
                            type="button"
                            onClick={() => loadAttendance(true)}
                            disabled={refreshing}
                        >
                            Try again
                        </button>
                    </div>
                )}

                <section className="student-attendance-summary">
                    <article className="student-summary-card">
                        <span>Total recorded classes</span>
                        <strong>{loading ? "—" : records.length}</strong>
                    </article>

                    <article className="student-summary-card">
                        <span>Present</span>
                        <strong className="student-present-number">
                            {loading ? "—" : presentCount}
                        </strong>
                    </article>

                    <article className="student-summary-card">
                        <span>Absent</span>
                        <strong className="student-absent-number">
                            {loading ? "—" : absentCount}
                        </strong>
                    </article>

                    <article className="student-summary-card">
                        <span>Attendance percentage</span>
                        <strong>
                            {loading ? "—" : `${attendancePercentage}%`}
                        </strong>
                    </article>
                </section>

                {!loading && records.length > 0 && (
                    <section className="student-attendance-progress">
                        <div className="student-progress-heading">
                            <span>Overall recorded attendance</span>
                            <strong>{attendancePercentage}%</strong>
                        </div>

                        <div
                            className="student-progress-track"
                            role="progressbar"
                            aria-label="Attendance percentage"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={attendancePercentage}
                        >
                            <div
                                className="student-progress-fill"
                                style={{
                                    width: `${attendancePercentage}%`,
                                }}
                            />
                        </div>

                        <p>
                            Calculated from records currently saved as Present
                            or Absent.{" "}
                            {otherCount > 0 &&
                                `${otherCount} record(s) with another status are excluded from the percentage.`}
                        </p>
                    </section>
                )}

                <section className="student-attendance-section">
                    <div className="student-attendance-section-heading">
                        <div>
                            <h2>Attendance records</h2>
                            <p>
                                Your saved attendance for individual classes.
                            </p>
                        </div>

                        <span className="student-record-count">
                            {loading ? "Loading..." : `${records.length} records`}
                        </span>
                    </div>

                    {loading ? (
                        <div className="student-attendance-empty">
                            Loading your attendance...
                        </div>
                    ) : records.length === 0 && !error ? (
                        <div className="student-attendance-empty">
                            <h3>No attendance records yet</h3>
                            <p>
                                Your attendance will appear here after it has
                                been recorded for a class.
                            </p>
                        </div>
                    ) : records.length > 0 ? (
                        <div className="student-attendance-table-wrapper">
                            <table className="student-attendance-table">
                                <thead>
                                    <tr>
                                        <th>Subject</th>
                                        <th>Batch</th>
                                        <th>Class date</th>
                                        <th>Class time</th>
                                        <th>Status</th>
                                    </tr>
                                </thead>

                                <tbody>
                                    {sortedRecords.map((record) => (
                                        <tr key={record.id}>
                                            <td data-label="Subject">
                                                <strong>{record.subject}</strong>
                                            </td>

                                            <td data-label="Batch">
                                                {record.batch || "—"}
                                            </td>

                                            <td data-label="Class date">
                                                {formatDate(record.date)}
                                            </td>

                                            <td data-label="Class time">
                                                {record.startTime
                                                    ? `${formatTime(record.startTime)}${
                                                          record.endTime
                                                              ? ` – ${formatTime(record.endTime)}`
                                                              : ""
                                                      }`
                                                    : "—"}
                                            </td>

                                            <td data-label="Status">
                                                <span
                                                    className={`student-status-badge ${
                                                        record.status === "present"
                                                            ? "student-status-present"
                                                            : record.status === "absent"
                                                              ? "student-status-absent"
                                                              : "student-status-unknown"
                                                    }`}
                                                >
                                                    {record.status
                                                        ? record.status
                                                              .charAt(0)
                                                              .toUpperCase() +
                                                          record.status.slice(1)
                                                        : "Not specified"}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : null}
                </section>

                {onOpenRegistration && (
                    <div className="student-registration-link">
                        <span>
                            Need to register or update your face profile?
                        </span>

                        <button
                            type="button"
                            onClick={onOpenRegistration}
                        >
                            Open face registration
                        </button>
                    </div>
                )}
            </section>
        </main>
    );
}

export default StudentDashboard;

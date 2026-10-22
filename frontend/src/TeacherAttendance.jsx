
import { useState, useEffect, useRef, useCallback } from "react";
import { jsPDF } from "jspdf";

const API_BASE_URL = (import.meta.env.VITE_API_URL || "http://localhost:5000/api");

function VideoFrameWithBoxes({
    frame,
    isRecognizedId,
    formatSimilarity,
}) {
    const imageUrl = frame?.frameImage;
    const originalWidth = Number(frame?.originalWidth);
    const originalHeight = Number(frame?.originalHeight);

    const [imageDimensions, setImageDimensions] = useState({
        width: 0,
        height: 0,
    });

    useEffect(() => {
        if (!imageUrl) {
            setImageDimensions({ width: 0, height: 0 });
            return;
        }

        const image = new Image();

        image.onload = () => {
            setImageDimensions({
                width: image.naturalWidth,
                height: image.naturalHeight,
            });
        };

        image.onerror = () => {
            setImageDimensions({ width: 0, height: 0 });
        };

        image.src = imageUrl;

        return () => {
            image.onload = null;
            image.onerror = null;
        };
    }, [imageUrl]);

    if (!imageUrl) {
        return (
            <div
                className="video-frame-image-missing"
                style={{
                    width: "100%",
                    minHeight: 180,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "#f3f4f6",
                    color: "#6b7280",
                    borderRadius: 8,
                    padding: 16,
                    boxSizing: "border-box",
                    textAlign: "center",
                }}
            >
                Frame preview is unavailable. Check that the backend returns
                frame_image for each processed video frame.
            </div>
        );
    }

    const width =
        originalWidth > 0 ? originalWidth : imageDimensions.width;

    const height =
        originalHeight > 0 ? originalHeight : imageDimensions.height;

    const faces = Array.isArray(frame?.faces) ? frame.faces : [];

    const validFaces = faces
        .map((face, index) => {
            if (!Array.isArray(face?.bbox) || face.bbox.length < 4) {
                return null;
            }

            let [x1, y1, x2, y2] = face.bbox.map(Number);

            if (![x1, y1, x2, y2].every(Number.isFinite)) {
                return null;
            }

            if (
                [x1, y1, x2, y2].every(
                    (coordinate) => coordinate >= 0 && coordinate <= 1
                )
            ) {
                x1 *= width;
                x2 *= width;
                y1 *= height;
                y2 *= height;
            }

            x1 = Math.max(0, Math.min(x1, width));
            x2 = Math.max(0, Math.min(x2, width));
            y1 = Math.max(0, Math.min(y1, height));
            y2 = Math.max(0, Math.min(y2, height));

            if (x2 <= x1 || y2 <= y1) {
                return null;
            }

            const recognized = isRecognizedId(face?.student_id);

            const studentLabel = recognized
                ? `Student ${face.student_id}`
                : "UNKNOWN";

            const scoreLabel = formatSimilarity(face?.similarity);

            return {
                index,
                x1,
                y1,
                x2,
                y2,
                boxWidth: x2 - x1,
                boxHeight: y2 - y1,
                recognized,
                color: recognized ? "#22c55e" : "#ef4444",
                studentLabel,
                scoreLabel,
                label: `${studentLabel} · ${scoreLabel}`,
            };
        })
        .filter(Boolean);

    const svgFontSize = Math.max(14, Math.min(width / 65, 30));
    const labelHeight = svgFontSize * 1.65;
    const labelPadding = svgFontSize * 0.45;

    return (
        <div
            className="video-frame-overlay-container"
            style={{
                position: "relative",
                width: "100%",
                overflow: "hidden",
                borderRadius: 8,
                background: "#111827",
                lineHeight: 0,
            }}
        >
            <img
                src={imageUrl}
                alt={`Processed video frame at ${Number(
                    frame?.timestamp_seconds ?? 0
                ).toFixed(1)} seconds`}
                loading="lazy"
                draggable={false}
                style={{
                    display: "block",
                    width: "100%",
                    height: "auto",
                }}
                onLoad={(event) => {
                    const image = event.currentTarget;

                    setImageDimensions({
                        width: image.naturalWidth,
                        height: image.naturalHeight,
                    });
                }}
            />

            {width > 0 && height > 0 && (
                <svg
                    viewBox={`0 0 ${width} ${height}`}
                    preserveAspectRatio="none"
                    role="img"
                    aria-label={`${validFaces.length} face bounding boxes`}
                    style={{
                        position: "absolute",
                        inset: 0,
                        display: "block",
                        width: "100%",
                        height: "100%",
                        pointerEvents: "none",
                        overflow: "hidden",
                    }}
                >
                    {validFaces.map((face) => {
                        const estimatedTextWidth =
                            face.label.length * svgFontSize * 0.58;

                        const labelWidth = Math.min(
                            width,
                            estimatedTextWidth + labelPadding * 2
                        );

                        const labelX = Math.max(
                            0,
                            Math.min(face.x1, width - labelWidth)
                        );

                        const labelY =
                            face.y1 >= labelHeight
                                ? face.y1 - labelHeight
                                : Math.min(face.y1, height - labelHeight);

                        return (
                            <g key={`video-face-${face.index}`}>
                                <rect
                                    x={face.x1}
                                    y={face.y1}
                                    width={face.boxWidth}
                                    height={face.boxHeight}
                                    fill="none"
                                    stroke={face.color}
                                    strokeWidth={Math.max(3, width / 450)}
                                    vectorEffect="non-scaling-stroke"
                                />

                                <rect
                                    x={labelX}
                                    y={Math.max(0, labelY)}
                                    width={labelWidth}
                                    height={labelHeight}
                                    rx={Math.max(2, svgFontSize * 0.12)}
                                    fill={face.color}
                                />

                                <text
                                    x={labelX + labelPadding}
                                    y={
                                        Math.max(0, labelY) +
                                        labelHeight * 0.68
                                    }
                                    fill="#ffffff"
                                    fontSize={svgFontSize}
                                    fontFamily="Arial, Helvetica, sans-serif"
                                    fontWeight="600"
                                >
                                    {face.label}
                                </text>
                            </g>
                        );
                    })}
                </svg>
            )}
        </div>
    );
}

function TeacherDashboard({ token }) {
    const [className, setClassName] = useState("");
    const [date, setDate] = useState("");
    const [subjectName, setSubjectName] = useState("AIML");
    const [startTime, setStartTime] = useState("09:00");
    const [endTime, setEndTime] = useState("10:00");
    const [sessionId, setSessionId] = useState(null);
    const [attendanceSaved, setAttendanceSaved] = useState(false);
    const [savingStudentIds, setSavingStudentIds] = useState([]);
    const [images, setImages] = useState([]);
    const [students, setStudents] = useState([]);
    const [results, setResults] = useState([]);
    const [attendance, setAttendance] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const [cameraOpen, setCameraOpen] = useState(false);
    const [cameraReady, setCameraReady] = useState(false);
    const [cameraError, setCameraError] = useState("");

    // "environment" is the rear camera; "user" is the front camera.
    const [cameraFacing, setCameraFacing] = useState("environment");

    const [videoFile, setVideoFile] = useState(null);
    const [videoPreview, setVideoPreview] = useState("");
    const [videoResults, setVideoResults] = useState([]);

    const [isRecording, setIsRecording] = useState(false);
    const [recordingSeconds, setRecordingSeconds] = useState(0);

    const [enlargedPreview, setEnlargedPreview] = useState(null);

    const videoRef = useRef(null);
    const streamRef = useRef(null);
    const fileInputRef = useRef(null);
    const videoInputRef = useRef(null);

    const imagesRef = useRef([]);
    const previewUrlRef = useRef("");
    const recorderRef = useRef(null);
    const recordingChunksRef = useRef([]);
    const recordingIntervalRef = useRef(null);
    const cameraRequestRef = useRef(0);
    const mountedRef = useRef(true);
    const modalCloseButtonRef = useRef(null);

    useEffect(() => {
        imagesRef.current = images;
    }, [images]);

    useEffect(() => {
        if (!enlargedPreview) return undefined;

        const handleKeyDown = (event) => {
            if (event.key === "Escape") {
                setEnlargedPreview(null);
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        modalCloseButtonRef.current?.focus();

        return () => {
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [enlargedPreview]);

    // Load students from the backend using the teacher's token.
    useEffect(() => {
        let cancelled = false;

        const fetchStudents = async () => {
            if (!token) {
                setError("Teacher session missing. Please log in again.");
                return;
            }

            try {
                const response = await fetch(`${API_BASE_URL}/students/`, {
                    method: "GET",
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                });

                const data = await response.json().catch(() => null);

                if (!response.ok) {
                    if (response.status === 401) {
                        throw new Error(
                            "Teacher authentication failed. Please log out and log in again."
                        );
                    }

                    throw new Error(
                        data?.message ||
                            data?.error ||
                            "Failed to fetch students."
                    );
                }

                if (cancelled) return;

                setStudents(
                    Array.isArray(data)
                        ? data
                        : Array.isArray(data?.students)
                          ? data.students
                          : []
                );

                setError("");
            } catch (err) {
                if (!cancelled) {
                    setError(err.message || "Could not load students.");
                }
            }
        };

        fetchStudents();

        return () => {
            cancelled = true;
        };
    }, [token]);

    // Clean up camera, timers, and preview URLs when unmounting.
    useEffect(() => {
        mountedRef.current = true;

        return () => {
            mountedRef.current = false;
            cameraRequestRef.current += 1;

            if (recordingIntervalRef.current) {
                window.clearInterval(recordingIntervalRef.current);
                recordingIntervalRef.current = null;
            }

            const recorder = recorderRef.current;

            if (recorder && recorder.state !== "inactive") {
                try {
                    recorder.stop();
                } catch {
                    // The recorder may already have stopped.
                }
            }

            streamRef.current?.getTracks().forEach((track) => track.stop());
            streamRef.current = null;

            imagesRef.current.forEach((image) => {
                URL.revokeObjectURL(image.url);
            });

            if (previewUrlRef.current) {
                URL.revokeObjectURL(previewUrlRef.current);
                previewUrlRef.current = "";
            }
        };
    }, []);

    const getStudentId = (student) =>
        student?.prn ??
        student?.student_prn ??
        student?.id_number ??
        student?.student_id ??
        student?.id ??
        "";

    const getStudentName = (student) =>
        student?.name ??
        student?.student_name ??
        student?.full_name ??
        "";

    const normalizeId = (value) =>
        String(value ?? "").trim().toUpperCase();

    const isRecognizedId = (studentId) => {
        const id = normalizeId(studentId);

        return (
            id !== "" &&
            id !== "UNKNOWN" &&
            id !== "NONE" &&
            id !== "NULL"
        );
    };

    const getSimilarityPercentage = (value) => {
        const similarity = Number(value);

        if (!Number.isFinite(similarity)) return null;

        if (similarity >= 0 && similarity <= 1) {
            return similarity * 100;
        }

        if (similarity > 1 && similarity <= 100) {
            return similarity;
        }

        return null;
    };

    const formatSimilarity = (value) => {
        const percentage = getSimilarityPercentage(value);

        return percentage === null
            ? "N/A"
            : `${percentage.toFixed(2)}%`;
    };

    const resetRecognition = () => {
        setResults([]);
        setVideoResults([]);
        setAttendance([]);
        setEnlargedPreview(null);
        setSessionId(null);
        setAttendanceSaved(false);
        setError("");
    };

    const handleClassChange = (event) => {
        setClassName(event.target.value);
        resetRecognition();
    };

    const handleDateChange = (event) => {
        setDate(event.target.value);
        resetRecognition();
    };

    const handleSessionFieldChange = (setter) => (event) => {
        setter(event.target.value);
        resetRecognition();
    };

    // Add selected or camera-captured images without removing existing photos.
    const addImages = useCallback((files) => {
        const selectedFiles = Array.from(files || []);
        const validFiles = selectedFiles.filter((file) =>
            file.type.startsWith("image/")
        );

        if (validFiles.length === 0) {
            setError("Please select valid image files.");
            return;
        }

        const newImages = validFiles.map((file) => ({
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            file,
            url: URL.createObjectURL(file),
            source: file.name.startsWith("camera-") ? "Camera" : "Upload",
        }));

        setImages((previous) => [...previous, ...newImages]);

        setResults([]);
        setVideoResults([]);
        setAttendance([]);
        setEnlargedPreview(null);
        setError("");
    }, []);

    const handleImages = (event) => {
        addImages(event.target.files);
        event.target.value = "";
    };

    const removeImage = (imageId) => {
        setImages((previous) => {
            const imageToRemove = previous.find(
                (image) => image.id === imageId
            );

            if (imageToRemove) {
                URL.revokeObjectURL(imageToRemove.url);
            }

            return previous.filter((image) => image.id !== imageId);
        });

        resetRecognition();
    };

    const removeAllImages = () => {
        images.forEach((image) => URL.revokeObjectURL(image.url));

        setImages([]);
        resetRecognition();
    };

    // Open either the front or rear camera.
    // Only the displayed preview is mirrored; the stream and captured media
    // remain unchanged.
    const openCamera = async (facing = cameraFacing) => {
        if (loading || isRecording) return;

        setCameraFacing(facing);
        setCameraError("");
        setError("");
        setCameraReady(false);
        setCameraOpen(true);

        const requestId = ++cameraRequestRef.current;

        // Stop the previous camera before requesting the selected camera.
        const previousStream = streamRef.current;
        streamRef.current = null;

        if (previousStream) {
            previousStream.getTracks().forEach((track) => track.stop());
        }

        if (videoRef.current) {
            videoRef.current.srcObject = null;
        }

        if (!navigator.mediaDevices?.getUserMedia) {
            setCameraError(
                "Camera access is not supported. Please use localhost or HTTPS."
            );
            return;
        }

        let stream = null;

        try {
            stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: { ideal: facing },
                    width: { ideal: 1920 },
                    height: { ideal: 1080 },
                },
                audio: false,
            });

            if (
                requestId !== cameraRequestRef.current ||
                !mountedRef.current
            ) {
                stream.getTracks().forEach((track) => track.stop());
                return;
            }

            streamRef.current = stream;

            // Allow React to render the camera dialog before attaching the stream.
            await new Promise((resolve) => window.setTimeout(resolve, 0));

            if (
                requestId !== cameraRequestRef.current ||
                !mountedRef.current
            ) {
                stream.getTracks().forEach((track) => track.stop());

                if (streamRef.current === stream) {
                    streamRef.current = null;
                }

                return;
            }

            const video = videoRef.current;

            if (!video) {
                stream.getTracks().forEach((track) => track.stop());

                if (streamRef.current === stream) {
                    streamRef.current = null;
                }

                setCameraError("Could not initialize the camera preview.");
                return;
            }

            video.srcObject = stream;
            await video.play();

            if (requestId === cameraRequestRef.current) {
                setCameraReady(true);
            }
        } catch (err) {
            if (requestId !== cameraRequestRef.current) return;

            if (stream) {
                stream.getTracks().forEach((track) => track.stop());

                if (streamRef.current === stream) {
                    streamRef.current = null;
                }
            }

            if (videoRef.current) {
                videoRef.current.srcObject = null;
            }

            setCameraReady(false);

            setCameraError(
                err.name === "NotAllowedError"
                    ? "Camera permission was denied. Allow camera access in your browser settings."
                    : err.name === "NotFoundError"
                      ? "No camera was found on this device."
                      : err.name === "NotReadableError"
                        ? "The selected camera is already in use. Close other apps using it and try again."
                        : "Could not open the selected camera. Check camera permissions and try again."
            );
        }
    };

    const capturePhoto = () => {
        const video = videoRef.current;

        if (
            !video ||
            !video.videoWidth ||
            !video.videoHeight ||
            !cameraReady
        ) {
            setCameraError("The camera is not ready yet.");
            return;
        }

        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        const context = canvas.getContext("2d");

        if (!context) {
            setCameraError("Could not capture the camera image.");
            return;
        }

        // Intentionally do not mirror the canvas. The saved photo remains
        // in the camera's original orientation.
        context.drawImage(video, 0, 0, canvas.width, canvas.height);

        canvas.toBlob(
            (blob) => {
                if (!blob) {
                    setCameraError("Failed to capture the photo.");
                    return;
                }

                const file = new File(
                    [blob],
                    `camera-${Date.now()}.jpg`,
                    { type: "image/jpeg" }
                );

                addImages([file]);
                setCameraError("");
            },
            "image/jpeg",
            0.92
        );
    };

    const clearRecordingInterval = () => {
        if (recordingIntervalRef.current) {
            window.clearInterval(recordingIntervalRef.current);
            recordingIntervalRef.current = null;
        }
    };

    const closeCamera = () => {
        cameraRequestRef.current += 1;

        if (
            recorderRef.current &&
            recorderRef.current.state !== "inactive"
        ) {
            try {
                recorderRef.current.stop();
            } catch {
                // It may have stopped between the state check and stop().
            }
        }

        clearRecordingInterval();
        setIsRecording(false);

        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;

        if (videoRef.current) {
            videoRef.current.srcObject = null;
        }

        setCameraReady(false);
        setCameraOpen(false);
        setCameraError("");
    };

    const getSupportedRecordingType = () => {
        if (typeof MediaRecorder === "undefined") {
            return "";
        }

        const types = [
            "video/webm;codecs=vp9",
            "video/webm;codecs=vp8",
            "video/webm",
        ];

        return (
            types.find((type) => MediaRecorder.isTypeSupported(type)) || ""
        );
    };

    const startRecording = () => {
        const stream = streamRef.current;

        if (!stream || !cameraReady) {
            setCameraError("Start the camera before recording.");
            return;
        }

        if (typeof MediaRecorder === "undefined") {
            setCameraError(
                "Video recording is not supported by this browser."
            );
            return;
        }

        try {
            const mimeType = getSupportedRecordingType();

            const recorder = mimeType
                ? new MediaRecorder(stream, { mimeType })
                : new MediaRecorder(stream);

            recordingChunksRef.current = [];
            recorderRef.current = recorder;

            recorder.ondataavailable = (event) => {
                if (event.data && event.data.size > 0) {
                    recordingChunksRef.current.push(event.data);
                }
            };

            recorder.onerror = () => {
                setCameraError("Video recording failed. Please try again.");

                clearRecordingInterval();
                setIsRecording(false);
            };

            recorder.onstop = () => {
                clearRecordingInterval();

                if (!mountedRef.current) return;

                const blob = new Blob(recordingChunksRef.current, {
                    type: recorder.mimeType || "video/webm",
                });

                recordingChunksRef.current = [];

                if (blob.size === 0) {
                    setCameraError(
                        "The recording was empty. Please record again."
                    );
                    setIsRecording(false);
                    return;
                }

                const extension = blob.type.includes("mp4")
                    ? "mp4"
                    : "webm";

                const file = new File(
                    [blob],
                    `attendance-${Date.now()}.${extension}`,
                    { type: blob.type }
                );

                if (previewUrlRef.current) {
                    URL.revokeObjectURL(previewUrlRef.current);
                }

                const url = URL.createObjectURL(file);

                previewUrlRef.current = url;

                setVideoFile(file);
                setVideoPreview(url);
                setVideoResults([]);
                setResults([]);
                setAttendance([]);
                setEnlargedPreview(null);
                setError("");
                setCameraError("");
                setIsRecording(false);
            };

            // Record the original stream, not the CSS-mirrored preview.
            recorder.start(1000);

            setIsRecording(true);
            setRecordingSeconds(0);
            setCameraError("");

            clearRecordingInterval();

            recordingIntervalRef.current = window.setInterval(() => {
                setRecordingSeconds((seconds) => seconds + 1);
            }, 1000);
        } catch {
            clearRecordingInterval();
            setIsRecording(false);
            setCameraError("Could not start video recording.");
        }
    };

    const stopRecording = () => {
        const recorder = recorderRef.current;

        if (recorder && recorder.state !== "inactive") {
            try {
                recorder.stop();
            } catch {
                setCameraError(
                    "Could not stop the recording. Please try again."
                );
            }
        }

        clearRecordingInterval();
        setIsRecording(false);
    };

    const handleVideoUpload = (event) => {
        const file = event.target.files?.[0];

        event.target.value = "";

        if (!file) return;

        if (!file.type.startsWith("video/")) {
            setError("Please select a valid video file.");
            return;
        }

        if (previewUrlRef.current) {
            URL.revokeObjectURL(previewUrlRef.current);
        }

        const url = URL.createObjectURL(file);

        previewUrlRef.current = url;

        setVideoFile(file);
        setVideoPreview(url);
        setVideoResults([]);
        setResults([]);
        setAttendance([]);
        setEnlargedPreview(null);
        setError("");
    };

    const clearVideo = () => {
        if (previewUrlRef.current) {
            URL.revokeObjectURL(previewUrlRef.current);
            previewUrlRef.current = "";
        }

        setVideoFile(null);
        setVideoPreview("");
        setVideoResults([]);
        setAttendance([]);
        setEnlargedPreview(null);
        setError("");
    };

    const createAnnotatedImage = (imageUrl, faces) =>
        new Promise((resolve, reject) => {
            const image = new Image();

            image.onload = () => {
                try {
                    const width = image.naturalWidth;
                    const height = image.naturalHeight;
                    const canvas = document.createElement("canvas");

                    canvas.width = width;
                    canvas.height = height;

                    const context = canvas.getContext("2d");

                    if (!context) {
                        reject(new Error("Could not create result image."));
                        return;
                    }

                    context.drawImage(image, 0, 0, width, height);

                    faces.forEach((face) => {
                        if (
                            !Array.isArray(face.bbox) ||
                            face.bbox.length < 4
                        ) {
                            return;
                        }

                        let [x1, y1, x2, y2] = face.bbox.map(Number);

                        if (![x1, y1, x2, y2].every(Number.isFinite)) {
                            return;
                        }

                        if (
                            [x1, y1, x2, y2].every(
                                (value) => value >= 0 && value <= 1
                            )
                        ) {
                            x1 *= width;
                            x2 *= width;
                            y1 *= height;
                            y2 *= height;
                        }

                        x1 = Math.max(0, Math.min(x1, width));
                        x2 = Math.max(0, Math.min(x2, width));
                        y1 = Math.max(0, Math.min(y1, height));
                        y2 = Math.max(0, Math.min(y2, height));

                        const boxWidth = x2 - x1;
                        const boxHeight = y2 - y1;

                        if (boxWidth <= 0 || boxHeight <= 0) return;

                        const isUnknown = !isRecognizedId(face.student_id);
                        const color = isUnknown ? "#ef4444" : "#22c55e";

                        context.strokeStyle = color;
                        context.lineWidth = Math.max(
                            4,
                            Math.round(width / 500)
                        );

                        context.strokeRect(x1, y1, boxWidth, boxHeight);

                        const studentText = isUnknown
                            ? "UNKNOWN"
                            : `Student ${face.student_id}`;

                        const similarityText =
                            `Match: ${formatSimilarity(face.similarity)}`;

                        const fontSize = Math.max(
                            20,
                            Math.round(width / 100)
                        );

                        const smallFontSize = Math.max(
                            16,
                            Math.round(width / 130)
                        );

                        context.font = `600 ${fontSize}px Arial`;

                        const studentTextWidth =
                            context.measureText(studentText).width;

                        context.font = `400 ${smallFontSize}px Arial`;

                        const similarityTextWidth =
                            context.measureText(similarityText).width;

                        const labelWidth =
                            Math.max(
                                studentTextWidth,
                                similarityTextWidth
                            ) + 24;

                        const labelHeight =
                            fontSize + smallFontSize + 18;

                        const labelX = Math.max(
                            0,
                            Math.min(x1, width - labelWidth)
                        );

                        const labelY = Math.max(
                            0,
                            Math.min(
                                y1 - labelHeight >= 0
                                    ? y1 - labelHeight
                                    : y1 + boxHeight,
                                height - labelHeight
                            )
                        );

                        context.fillStyle = color;

                        context.fillRect(
                            labelX,
                            labelY,
                            labelWidth,
                            labelHeight
                        );

                        context.fillStyle = "#ffffff";
                        context.font = `600 ${fontSize}px Arial`;

                        context.fillText(
                            studentText,
                            labelX + 12,
                            labelY + fontSize + 2
                        );

                        context.font = `400 ${smallFontSize}px Arial`;

                        context.fillText(
                            similarityText,
                            labelX + 12,
                            labelY + fontSize + smallFontSize + 5
                        );
                    });

                    resolve(canvas.toDataURL("image/jpeg", 0.95));
                } catch {
                    reject(new Error("Could not create result image."));
                }
            };

            image.onerror = () => {
                reject(new Error("Could not load the image for annotation."));
            };

            image.src = imageUrl;
        });

    const applyAttendance = (faceGroups) => {
        const recognizedStudents = new Set(
            faceGroups
                .flat()
                .filter((face) => isRecognizedId(face.student_id))
                .map((face) => normalizeId(face.student_id))
        );

        setAttendance(
            students.map((student) => {
                const studentId = getStudentId(student);

                return {
                    student_id: studentId,
                    student_name: getStudentName(student),
                    status: recognizedStudents.has(normalizeId(studentId))
                        ? "Present"
                        : "Absent",
                };
            })
        );
    };

    const recognizeAttendance = async () => {
        if (!token) {
            setError("Teacher session missing. Please log in again.");
            return;
        }

        if (
            !className ||
            !date ||
            !subjectName.trim() ||
            !startTime ||
            !endTime
        ) {
            setError(
                "Please select a class, subject, date, start time, and end time."
            );
            return;
        }

        if (endTime <= startTime) {
            setError("End time must be later than start time.");
            return;
        }

        if (images.length === 0 && !videoFile) {
            setError(
                "Please open the camera, upload multiple photos, or upload a video."
            );
            return;
        }

        if (students.length === 0) {
            setError(
                "The student list is empty or could not be loaded. Please check your student data and try again."
            );
            return;
        }

        setError("");
        setResults([]);
        setVideoResults([]);
        setAttendance([]);
        setEnlargedPreview(null);
        setSessionId(null);
        setAttendanceSaved(false);
        setLoading(true);

        try {
            const authHeaders = {
                Authorization: `Bearer ${token}`,
            };

            const sessionResponse = await fetch(
                `${API_BASE_URL}/attendance/sessions`,
                {
                    method: "POST",
                    headers: {
                        ...authHeaders,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        batch_name: className,
                        subject_name: subjectName.trim(),
                        class_date: date,
                        start_time: startTime,
                        end_time: endTime,
                    }),
                }
            );

            const sessionData = await sessionResponse
                .json()
                .catch(() => null);

            if (
                !sessionResponse.ok ||
                !sessionData?.success ||
                !sessionData?.session?.id
            ) {
                throw new Error(
                    sessionData?.message ||
                        sessionData?.error ||
                        "Could not create an attendance session. Check the backend logs and session fields."
                );
            }

            const createdSessionId = sessionData.session.id;
            setSessionId(createdSessionId);

            const allPhotoResults = [];
            const allVideoResults = [];
            const allFaceGroups = [];
            let backendSavedAnyAttendance = false;

            for (const image of images) {
                const formData = new FormData();
                formData.append("image", image.file);
                formData.append("session_id", String(createdSessionId));

                const response = await fetch(
                    `${API_BASE_URL}/recognize-group`,
                    {
                        method: "POST",
                        headers: authHeaders,
                        body: formData,
                    }
                );

                const data = await response.json().catch(() => null);

                if (!response.ok || data?.success === false) {
                    throw new Error(
                        data?.message ||
                            data?.error ||
                            `Recognition failed for ${image.file.name}.`
                    );
                }

                if (data?.attendance_saved) {
                    backendSavedAnyAttendance = true;
                }

                const faces = Array.isArray(data?.faces) ? data.faces : [];
                let resultImage = image.url;

                try {
                    resultImage = await createAnnotatedImage(image.url, faces);
                } catch {
                    // Keep the original photo visible if annotation fails.
                }

                allPhotoResults.push({
                    imageId: image.id,
                    imageUrl: resultImage,
                    fileName: image.file.name,
                    faces,
                });

                allFaceGroups.push(faces);
            }

            if (videoFile) {
                const formData = new FormData();
                formData.append("video", videoFile);
                formData.append("session_id", String(createdSessionId));

                const response = await fetch(
                    `${API_BASE_URL}/recognize-video`,
                    {
                        method: "POST",
                        headers: authHeaders,
                        body: formData,
                    }
                );

                const data = await response.json().catch(() => null);

                if (!response.ok || data?.success === false) {
                    throw new Error(
                        data?.message ||
                            data?.error ||
                            "Video recognition failed."
                    );
                }

                if (data?.attendance_saved) {
                    backendSavedAnyAttendance = true;
                }

                const frames = Array.isArray(data?.frames) ? data.frames : [];

                for (let index = 0; index < frames.length; index++) {
                    const frame = frames[index];
                    const faces = Array.isArray(frame?.faces)
                        ? frame.faces
                        : [];

                    const recognizedCount = faces.filter((face) =>
                        isRecognizedId(face.student_id)
                    ).length;

                    allVideoResults.push({
                        timestamp_seconds: Number(
                            frame?.timestamp_seconds ?? 0
                        ),
                        frameIndex: index,
                        frameImage: frame?.frame_image ?? null,
                        originalWidth: Number(frame?.original_width ?? 0),
                        originalHeight: Number(frame?.original_height ?? 0),
                        faces,
                        recognizedCount,
                        unknownCount: faces.length - recognizedCount,
                    });

                    allFaceGroups.push(faces);
                }

                if (frames.length === 0) {
                    setError(
                        "The video was processed, but the backend returned no sampled frames."
                    );
                }
            }

            setResults(allPhotoResults);
            setVideoResults(allVideoResults);

            const allFaces = allFaceGroups.flat();

            const recognizedIds = new Set(
                allFaces
                    .filter((face) => isRecognizedId(face.student_id))
                    .map((face) => normalizeId(face.student_id))
            );

            setAttendance(
                students.map((student) => {
                    const studentId = getStudentId(student);

                    return {
                        student_id: studentId,
                        student_name: getStudentName(student),
                        status: recognizedIds.has(normalizeId(studentId))
                            ? "Present"
                            : "Absent",
                    };
                })
            );

            setAttendanceSaved(backendSavedAnyAttendance);

            if (!backendSavedAnyAttendance) {
                setError(
                    "Recognition finished, but the backend did not confirm that attendance was saved. The table below is a local preview only."
                );
            }
        } catch (err) {
            setError(
                err.message ||
                    "Something went wrong while recognizing attendance."
            );
        } finally {
            setLoading(false);
        }
    };

    const updateAttendanceStatus = async (studentId, status) => {
        if (!sessionId) {
            setError(
                "No active attendance session. Run recognition first, then edit attendance."
            );
            return;
        }

        if (!token) {
            setError("Teacher session missing. Please log in again.");
            return;
        }

        const normalizedStudentId = normalizeId(studentId);

        setError("");

        setSavingStudentIds((previous) =>
            previous.includes(normalizedStudentId)
                ? previous
                : [...previous, normalizedStudentId]
        );

        try {
            const response = await fetch(
                `${API_BASE_URL}/attendance/sessions/${encodeURIComponent(
                    sessionId
                )}/records`,
                {
                    method: "PATCH",
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        student_prn: String(studentId).trim(),
                        status: String(status).toLowerCase(),
                    }),
                }
            );

            const data = await response.json().catch(() => null);

            if (!response.ok || data?.success === false) {
                throw new Error(
                    data?.message ||
                        data?.error ||
                        "Could not save the attendance change."
                );
            }

            setAttendance((previous) =>
                previous.map((student) =>
                    normalizeId(student.student_id) === normalizedStudentId
                        ? { ...student, status }
                        : student
                )
            );

            setAttendanceSaved(true);
        } catch (err) {
            setError(
                err.message ||
                    "Could not save the attendance change. Please try again."
            );
        } finally {
            setSavingStudentIds((previous) =>
                previous.filter((id) => id !== normalizedStudentId)
            );
        }
    };

    const presentCount = attendance.filter(
        (student) => student.status === "Present"
    ).length;

    const absentCount = attendance.filter(
        (student) => student.status === "Absent"
    ).length;

    const generateAttendanceCSV = () => {
        if (attendance.length === 0) {
            setError(
                "Please recognize attendance before downloading the CSV."
            );
            return;
        }

        if (!className || !date) {
            setError("Please select a class and date before exporting.");
            return;
        }

        try {
            const escapeCSV = (value) => {
                const text = String(value ?? "");
                return `"${text.replace(/"/g, '""')}"`;
            };

            const rows = [
                ["Class", className],
                ["Attendance Date", date],
                [],
                ["Student ID", "Student Name", "Attendance"],
                ...attendance.map((student) => [
                    student.student_id ?? "",
                    student.student_name ?? "",
                    student.status ?? "",
                ]),
            ];

            const csvContent =
                "\uFEFF" +
                rows
                    .map((row) => row.map(escapeCSV).join(","))
                    .join("\r\n");

            const blob = new Blob([csvContent], {
                type: "text/csv;charset=utf-8;",
            });

            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");

            const safeClassName = String(className).replace(
                /[^a-z0-9_-]/gi,
                "_"
            );

            link.href = url;
            link.download = `Attendance_${safeClassName}_${date}.csv`;

            document.body.appendChild(link);
            link.click();
            link.remove();

            window.setTimeout(() => URL.revokeObjectURL(url), 1000);

            setError("");
        } catch {
            setError("Could not generate the CSV file. Please try again.");
        }
    };

    const generateAttendancePDF = () => {
        if (attendance.length === 0) {
            setError(
                "Please recognize attendance before generating the PDF."
            );
            return;
        }

        if (!className || !date) {
            setError("Please select a class and date before exporting.");
            return;
        }

        try {
            const pdf = new jsPDF({
                orientation: "portrait",
                unit: "mm",
                format: "a4",
            });

            const pageWidth = pdf.internal.pageSize.getWidth();
            const pageHeight = pdf.internal.pageSize.getHeight();
            const margin = 15;
            const contentWidth = pageWidth - margin * 2;

            const formatDate = (value) => {
                if (!value) return "N/A";

                const [year, month, day] = value.split("-");

                return `${day}/${month}/${year}`;
            };

            const generatedAt = new Date().toLocaleString();

            pdf.setFont("helvetica", "bold");
            pdf.setFontSize(19);

            pdf.text("ATTENDANCE REPORT", pageWidth / 2, 20, {
                align: "center",
            });

            pdf.setFont("helvetica", "normal");
            pdf.setFontSize(10);

            pdf.text(
                "Face Recognition Attendance System",
                pageWidth / 2,
                27,
                { align: "center" }
            );

            pdf.setDrawColor(170, 170, 170);
            pdf.line(margin, 32, pageWidth - margin, 32);

            const y = 42;

            pdf.setFontSize(11);
            pdf.setFont("helvetica", "bold");
            pdf.text("Class:", margin, y);

            pdf.setFont("helvetica", "normal");
            pdf.text(String(className), margin + 20, y);

            pdf.setFont("helvetica", "bold");
            pdf.text("Attendance Date:", margin, y + 8);

            pdf.setFont("helvetica", "normal");
            pdf.text(formatDate(date), margin + 38, y + 8);

            pdf.setFont("helvetica", "bold");
            pdf.text("Generated:", margin, y + 16);

            pdf.setFont("helvetica", "normal");
            pdf.text(generatedAt, margin + 25, y + 16);

            const summaryY = y + 25;
            const gap = 5;
            const cardWidth = (contentWidth - gap * 2) / 3;
            const cardHeight = 19;

            [
                { label: "TOTAL STUDENTS", value: attendance.length },
                { label: "PRESENT", value: presentCount },
                { label: "ABSENT", value: absentCount },
            ].forEach((item, index) => {
                const x = margin + index * (cardWidth + gap);

                pdf.setDrawColor(190, 190, 190);
                pdf.setFillColor(245, 247, 250);

                pdf.roundedRect(
                    x,
                    summaryY,
                    cardWidth,
                    cardHeight,
                    2,
                    2,
                    "FD"
                );

                pdf.setFont("helvetica", "normal");
                pdf.setFontSize(8);
                pdf.setTextColor(80, 80, 80);

                pdf.text(
                    item.label,
                    x + cardWidth / 2,
                    summaryY + 6,
                    { align: "center" }
                );

                pdf.setFont("helvetica", "bold");
                pdf.setFontSize(14);
                pdf.setTextColor(25, 25, 25);

                pdf.text(
                    String(item.value),
                    x + cardWidth / 2,
                    summaryY + 14,
                    { align: "center" }
                );
            });

            let tableY = summaryY + cardHeight + 12;

            const columns = [
                { label: "S.No.", x: margin, width: 17 },
                { label: "Student ID", x: margin + 17, width: 48 },
                {
                    label: "Student Name",
                    x: margin + 65,
                    width: contentWidth - 97,
                },
                {
                    label: "Status",
                    x: margin + contentWidth - 32,
                    width: 32,
                },
            ];

            const rowHeight = 9;

            const drawTableHeader = () => {
                pdf.setFillColor(42, 57, 80);
                pdf.rect(margin, tableY, contentWidth, rowHeight, "F");

                pdf.setFont("helvetica", "bold");
                pdf.setFontSize(9);
                pdf.setTextColor(255, 255, 255);

                columns.forEach((column) => {
                    pdf.text(column.label, column.x + 2, tableY + 6);
                });

                tableY += rowHeight;
            };

            const drawFooter = (pageNumber, totalPages) => {
                pdf.setFont("helvetica", "normal");
                pdf.setFontSize(8);
                pdf.setTextColor(100, 100, 100);

                pdf.text(
                    `Attendance Report | Class: ${className} | Date: ${formatDate(date)}`,
                    margin,
                    pageHeight - 10
                );

                pdf.text(
                    `Page ${pageNumber} of ${totalPages}`,
                    pageWidth - margin,
                    pageHeight - 10,
                    { align: "right" }
                );
            };

            drawTableHeader();

            pdf.setFont("helvetica", "normal");
            pdf.setFontSize(9);

            attendance.forEach((student, index) => {
                if (tableY + rowHeight > pageHeight - 18) {
                    pdf.addPage();
                    tableY = 18;
                    drawTableHeader();

                    pdf.setFont("helvetica", "normal");
                    pdf.setFontSize(9);
                }

                if (index % 2 === 1) {
                    pdf.setFillColor(245, 247, 250);
                    pdf.rect(margin, tableY, contentWidth, rowHeight, "F");
                }

                pdf.setTextColor(35, 35, 35);

                const studentId = String(student.student_id ?? "N/A");
                const studentName = String(student.student_name || "N/A");
                const status = String(student.status || "N/A");

                pdf.text(
                    String(index + 1),
                    columns[0].x + 2,
                    tableY + 6
                );

                pdf.text(
                    pdf.splitTextToSize(
                        studentId,
                        columns[1].width - 4
                    )[0],
                    columns[1].x + 2,
                    tableY + 6
                );

                pdf.text(
                    pdf.splitTextToSize(
                        studentName,
                        columns[2].width - 4
                    )[0],
                    columns[2].x + 2,
                    tableY + 6
                );

                pdf.setTextColor(
                    status === "Present" ? 22 : 190,
                    status === "Present" ? 128 : 45,
                    status === "Present" ? 65 : 45
                );

                pdf.text(status, columns[3].x + 2, tableY + 6);
                pdf.setTextColor(35, 35, 35);

                pdf.setDrawColor(225, 225, 225);

                pdf.line(
                    margin,
                    tableY + rowHeight,
                    pageWidth - margin,
                    tableY + rowHeight
                );

                tableY += rowHeight;
            });

            const totalPages = pdf.getNumberOfPages();

            for (let page = 1; page <= totalPages; page++) {
                pdf.setPage(page);
                drawFooter(page, totalPages);
            }

            const safeClassName = String(className).replace(
                /[^a-z0-9_-]/gi,
                "_"
            );

            pdf.save(`Attendance_${safeClassName}_${date}.pdf`);

            setError("");
        } catch {
            setError("Could not generate the PDF. Please try again.");
        }
    };

    const openPhotoPreview = (imageResult, index) => {
        setEnlargedPreview({
            type: "photo",
            title: `Group Photo ${index + 1} — ${imageResult.fileName}`,
            imageUrl: imageResult.imageUrl,
        });
    };

    const openVideoFramePreview = (frame, index) => {
        setEnlargedPreview({
            type: "video",
            title: `Processed Frame ${index + 1} — ${Number(
                frame.timestamp_seconds ?? 0
            ).toFixed(1)} seconds`,
            frame,
        });
    };

    const handlePreviewKeyDown = (event, openPreview) => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openPreview();
        }
    };

    return (
        <div className="attendance-container">
            <div className="attendance-header">
                <h1>Teacher Dashboard</h1>
                <p>
                    Capture group photos or upload a video to generate
                    attendance.
                </p>
            </div>

            <div className="attendance-form">
                <div className="form-group">
                    <label htmlFor="attendance-class">Class</label>

                    <select
                        id="attendance-class"
                        value={className}
                        onChange={handleClassChange}
                        disabled={loading}
                    >
                        <option value="">Select Class</option>
                        <option value="AIML MDM Batch A1">AIML MDM Batch A1</option>
                        <option value="AIML MDM Batch A2">AIML MDM Batch A2</option>
                        <option value="AIML MDM Batch A3">AIML MDM Batch A3</option>
                        <option value="AIML MDM Batch A4">AIML MDM Batch A4</option>
                    </select>
                </div>

                <div className="form-group">
                    <label htmlFor="attendance-date">Date</label>

                    <input
                        id="attendance-date"
                        type="date"
                        value={date}
                        onChange={handleDateChange}
                        disabled={loading}
                    />
                </div>

                <div className="form-group">
                    <label htmlFor="attendance-subject">Subject</label>
                    <input
                        id="attendance-subject"
                        type="text"
                        value={subjectName}
                        onChange={handleSessionFieldChange(setSubjectName)}
                        disabled={loading}
                        placeholder="e.g. AIML"
                    />
                </div>

                <div className="form-group">
                    <label htmlFor="attendance-start-time">Start Time</label>
                    <input
                        id="attendance-start-time"
                        type="time"
                        value={startTime}
                        onChange={handleSessionFieldChange(setStartTime)}
                        disabled={loading}
                    />
                </div>

                <div className="form-group">
                    <label htmlFor="attendance-end-time">End Time</label>
                    <input
                        id="attendance-end-time"
                        type="time"
                        value={endTime}
                        onChange={handleSessionFieldChange(setEndTime)}
                        disabled={loading}
                    />
                </div>

                <div className="form-group full-width">
                    <label>Attendance Media</label>

                    <p style={{ marginBottom: 12 }}>
                        Choose one or more options below: open the camera to
                        capture group photos or record a video, upload multiple
                        group photos, or upload a video. Photos and video can
                        be processed together.
                    </p>

                    <div className="photo-action-buttons">
                        <button
                            type="button"
                            className="photo-action-button camera-action-button"
                            onClick={openCamera}
                            disabled={loading || cameraOpen}
                        >
                            📷 Open Camera
                        </button>

                        <button
                            type="button"
                            className="photo-action-button upload-action-button"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={loading}
                        >
                            📁 Upload Multiple Photos
                        </button>

                        <button
                            type="button"
                            className="photo-action-button upload-action-button"
                            onClick={() => videoInputRef.current?.click()}
                            disabled={loading}
                        >
                            🎥 Upload Video
                        </button>
                    </div>

                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={handleImages}
                        disabled={loading}
                        style={{ display: "none" }}
                    />

                    <input
                        ref={videoInputRef}
                        id="attendance-video"
                        type="file"
                        accept="video/*"
                        onChange={handleVideoUpload}
                        disabled={loading}
                        style={{ display: "none" }}
                    />

                    <p className="selected-photo-count">
                        {images.length} photo
                        {images.length === 1 ? "" : "s"} selected
                    </p>
                </div>

                {images.length > 0 && (
                    <div className="selected-images full-width">
                        <h3>Selected Photos</h3>

                        <div className="image-preview-list">
                            {images.map((image, index) => (
                                <div
                                    className="image-preview-card"
                                    key={image.id}
                                >
                                    <img
                                        src={image.url}
                                        alt={`Group photo ${index + 1}`}
                                    />

                                    <div className="image-preview-info">
                                        <span>
                                            Photo {index + 1}
                                            <br />
                                            <small>
                                                {image.source === "Camera"
                                                    ? "Captured with camera"
                                                    : image.file.name}
                                            </small>
                                        </span>

                                        <button
                                            type="button"
                                            onClick={() => removeImage(image.id)}
                                            disabled={loading}
                                        >
                                            Remove
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>

                        <button
                            type="button"
                            className="remove-all-photos-button"
                            onClick={removeAllImages}
                            disabled={loading}
                        >
                            🗑 Remove All Photos
                        </button>
                    </div>
                )}

                {videoPreview && (
                    <div className="form-group full-width">
                        <label>Selected Group Video</label>

                        <p style={{ marginBottom: 12 }}>
                            Review your selected or recorded video. The video
                            will be processed with any selected photos.
                            Processed frame previews will display bounding
                            boxes, student labels, and similarity scores.
                        </p>

                        <div className="video-preview-container">
                            <video
                                className="attendance-video-preview"
                                src={videoPreview}
                                controls
                                playsInline
                            />

                            <p>
                                Selected video:{" "}
                                <strong>
                                    {videoFile?.name || "Recorded video"}
                                </strong>
                            </p>

                            <button
                                type="button"
                                className="remove-all-photos-button"
                                onClick={clearVideo}
                                disabled={loading}
                            >
                                Remove Video
                            </button>
                        </div>
                    </div>
                )}

                <button
                    className="recognize-button"
                    onClick={recognizeAttendance}
                    disabled={
                        loading ||
                        !className ||
                        !date ||
                        (images.length === 0 && !videoFile)
                    }
                    type="button"
                >
                    {loading
                        ? "Recognizing Attendance..."
                        : "Recognize Attendance"}
                </button>

                {loading && (
                    <p role="status">
                        Processing selected photos and video. Please keep this
                        page open until processing finishes.
                    </p>
                )}

                {error && (
                    <p className="error" role="alert">
                        {error}
                    </p>
                )}
            </div>

            {/* Camera dialog with front/rear camera switching */}
            {cameraOpen && (
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="camera-dialog-title"
                    className="teacher-camera-overlay"
                >
                    <div className="teacher-camera-dialog">
                        <h2 id="camera-dialog-title">Camera</h2>

                        <p>
                            Capture group photos or record a video. Captured
                            photos are added to Selected Photos, and a completed
                            recording appears in the video preview.
                        </p>

                        {cameraError && (
                            <p className="error" role="alert">
                                {cameraError}
                            </p>
                        )}

                        <div
                            className="teacher-camera-actions"
                            style={{
                                marginTop: 12,
                                marginBottom: 12,
                                display: "flex",
                                flexWrap: "wrap",
                                gap: 8,
                            }}
                        >
                            <button
                                type="button"
                                className="recognize-button"
                                onClick={() => openCamera("user")}
                                disabled={
                                    loading ||
                                    isRecording ||
                                    cameraFacing === "user"
                                }
                            >
                                🤳 Front Camera
                            </button>

                            <button
                                type="button"
                                className="recognize-button"
                                onClick={() => openCamera("environment")}
                                disabled={
                                    loading ||
                                    isRecording ||
                                    cameraFacing === "environment"
                                }
                            >
                                📷 Back Camera
                            </button>
                        </div>

                        <div className="teacher-camera-video">
                            <video
                                ref={videoRef}
                                autoPlay
                                muted
                                playsInline
                                style={{
                                    width: "100%",
                                    transform:
                                        cameraFacing === "user"
                                            ? "scaleX(-1)"
                                            : "none",
                                }}
                            />
                        </div>

                        {!cameraReady && !cameraError && (
                            <p role="status" style={{ marginTop: 12 }}>
                                Starting camera...
                            </p>
                        )}

                        {isRecording && (
                            <p role="status" style={{ marginTop: 12 }}>
                                <strong>
                                    Recording:{" "}
                                    {Math.floor(recordingSeconds / 60)
                                        .toString()
                                        .padStart(2, "0")}
                                    :
                                    {(recordingSeconds % 60)
                                        .toString()
                                        .padStart(2, "0")}
                                </strong>
                            </p>
                        )}

                        <div className="teacher-camera-actions">
                            <button
                                type="button"
                                className="recognize-button"
                                onClick={capturePhoto}
                                disabled={
                                    !cameraReady ||
                                    loading ||
                                    isRecording
                                }
                            >
                                Capture Photo
                            </button>

                            {!isRecording ? (
                                <button
                                    type="button"
                                    className="recognize-button"
                                    onClick={startRecording}
                                    disabled={!cameraReady || loading}
                                >
                                    Start Recording
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    className="recognize-button"
                                    onClick={stopRecording}
                                >
                                    Stop Recording
                                </button>
                            )}

                            <button
                                type="button"
                                className="recognize-button"
                                onClick={closeCamera}
                            >
                                Done / Close
                            </button>
                        </div>

                        <p style={{ marginTop: 12 }}>
                            {images.length} photo
                            {images.length === 1 ? "" : "s"} selected.
                            {isRecording
                                ? " Video recording is in progress."
                                : " Captured photos are added to the photo list."}
                        </p>
                    </div>
                </div>
            )}

            {/* Attendance summary, manual status editing, and exports */}
            {attendance.length > 0 && (
                <div className="attendance-results">
                    <h2>Attendance Summary</h2>

                    <p role="status">
                        Session: {sessionId ?? "Not available"}.{" "}
                        {attendanceSaved
                            ? "The backend has confirmed attendance saves. Manual dropdown changes are saved automatically."
                            : "Recognition results have not yet been confirmed as saved by the backend."}
                    </p>

                    <div className="summary">
                        <div className="summary-card">
                            <span>Present</span>
                            <strong>{presentCount}</strong>
                        </div>

                        <div className="summary-card">
                            <span>Absent</span>
                            <strong>{absentCount}</strong>
                        </div>

                        <div className="summary-card">
                            <span>Total</span>
                            <strong>{attendance.length}</strong>
                        </div>
                    </div>

                    <div className="attendance-export-buttons">
                        <button
                            type="button"
                            className="recognize-button"
                            onClick={generateAttendancePDF}
                            disabled={loading}
                        >
                            📄 Download Attendance PDF
                        </button>

                        <button
                            type="button"
                            className="recognize-button"
                            onClick={generateAttendanceCSV}
                            disabled={loading}
                        >
                            📊 Download Attendance CSV
                        </button>
                    </div>

                    <table>
                        <thead>
                            <tr>
                                <th>Student ID</th>
                                <th>Student Name</th>
                                <th>Attendance</th>
                            </tr>
                        </thead>

                        <tbody>
                            {attendance.map((student, index) => (
                                <tr key={`${student.student_id}-${index}`}>
                                    <td>{student.student_id}</td>
                                    <td>{student.student_name || "—"}</td>
                                    <td>
                                        <select
                                            aria-label={`Attendance for ${student.student_name || student.student_id}`}
                                            value={student.status}
                                            onChange={(event) =>
                                                updateAttendanceStatus(
                                                    student.student_id,
                                                    event.target.value
                                                )
                                            }
                                            disabled={
                                                loading ||
                                                savingStudentIds.includes(
                                                    normalizeId(
                                                        student.student_id
                                                    )
                                                )
                                            }
                                        >
                                            <option value="Present">
                                                Present
                                            </option>
                                            <option value="Absent">
                                                Absent
                                            </option>
                                        </select>

                                        {savingStudentIds.includes(
                                            normalizeId(student.student_id)
                                        ) && (
                                            <small
                                                role="status"
                                                style={{
                                                    display: "block",
                                                    marginTop: 4,
                                                }}
                                            >
                                                Saving…
                                            </small>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Photo recognition results */}
            {results.length > 0 && (
                <div className="results recognition-results-grid">
                    <div className="recognition-results-header">
                        <h2>Photo Recognition Results</h2>

                        <p>
                            Click any result image to enlarge it and inspect
                            the bounding boxes and similarity scores.
                        </p>
                    </div>

                    <div className="recognition-cards-grid">
                        {results.map((imageResult, index) => {
                            const recognizedCount =
                                imageResult.faces.filter((face) =>
                                    isRecognizedId(face.student_id)
                                ).length;

                            const unknownCount =
                                imageResult.faces.length - recognizedCount;

                            const openPreview = () =>
                                openPhotoPreview(imageResult, index);

                            return (
                                <div
                                    className="recognition-result-card"
                                    key={imageResult.imageId}
                                >
                                    <div className="recognition-card-heading">
                                        <h3>Group Photo {index + 1}</h3>

                                        <span className="recognition-face-count">
                                            {imageResult.faces.length} faces
                                        </span>
                                    </div>

                                    <p
                                        className="recognition-file-name"
                                        title={imageResult.fileName}
                                    >
                                        {imageResult.fileName}
                                    </p>

                                    <div
                                        className="recognition-card-image recognition-clickable-preview"
                                        role="button"
                                        tabIndex={0}
                                        aria-label={`Enlarge recognition results for ${imageResult.fileName}`}
                                        title="Click to enlarge"
                                        onClick={openPreview}
                                        onKeyDown={(event) =>
                                            handlePreviewKeyDown(
                                                event,
                                                openPreview
                                            )
                                        }
                                    >
                                        <img
                                            src={imageResult.imageUrl}
                                            alt={`Recognition results for ${imageResult.fileName}`}
                                            loading="lazy"
                                            draggable={false}
                                        />
                                        <span className="preview-zoom-hint">
                                            ⤢ Click to enlarge
                                        </span>
                                    </div>

                                    <div className="recognition-card-stats">
                                        <div className="recognition-stat recognized-stat">
                                            <span>Recognized</span>
                                            <strong>{recognizedCount}</strong>
                                        </div>

                                        <div className="recognition-stat unknown-stat">
                                            <span>Unknown</span>
                                            <strong>{unknownCount}</strong>
                                        </div>
                                    </div>

                                    {imageResult.faces.length > 0 ? (
                                        <div className="recognition-face-list">
                                            <h4>Detected People</h4>

                                            {imageResult.faces.map(
                                                (face, faceIndex) => {
                                                    const unknown =
                                                        !isRecognizedId(
                                                            face.student_id
                                                        );

                                                    return (
                                                        <div
                                                            className="recognition-person-row"
                                                            key={`${imageResult.imageId}-${faceIndex}`}
                                                        >
                                                            <div>
                                                                <span
                                                                    className={
                                                                        unknown
                                                                            ? "person-status-dot unknown-dot"
                                                                            : "person-status-dot recognized-dot"
                                                                    }
                                                                />

                                                                <span>
                                                                    {unknown
                                                                        ? "Unknown person"
                                                                        : `Student ${face.student_id}`}
                                                                </span>
                                                            </div>

                                                            <span
                                                                className={
                                                                    unknown
                                                                        ? "person-match unknown-match"
                                                                        : "person-match recognized-match"
                                                                }
                                                            >
                                                                {formatSimilarity(
                                                                    face.similarity
                                                                )}
                                                            </span>
                                                        </div>
                                                    );
                                                }
                                            )}
                                        </div>
                                    ) : (
                                        <p className="no-faces-message">
                                            No faces detected in this photo.
                                        </p>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Video recognition results */}
            {videoResults.length > 0 && (
                <div className="results recognition-results-grid">
                    <div className="recognition-results-header">
                        <h2>Video Recognition Results</h2>

                        <p>
                            {videoResults.length} sampled frame
                            {videoResults.length === 1 ? "" : "s"} processed.
                            Click any frame to enlarge it. Green boxes indicate
                            recognized students; red boxes indicate unknown
                            people.
                        </p>
                    </div>

                    <div className="recognition-cards-grid">
                        {videoResults.map((frame, frameIndex) => {
                            const faces = Array.isArray(frame.faces)
                                ? frame.faces
                                : [];

                            const timestamp = Number(
                                frame.timestamp_seconds ?? 0
                            );

                            const openPreview = () =>
                                openVideoFramePreview(frame, frameIndex);

                            return (
                                <div
                                    className="recognition-result-card video-frame-result"
                                    key={`${timestamp}-${frameIndex}`}
                                >
                                    <div className="recognition-card-heading">
                                        <h3>Processed Frame {frameIndex + 1}</h3>

                                        <span className="recognition-face-count">
                                            {timestamp.toFixed(1)} sec
                                        </span>
                                    </div>

                                    <div
                                        className="video-frame-preview recognition-clickable-preview"
                                        style={{ marginTop: 12 }}
                                        role="button"
                                        tabIndex={0}
                                        aria-label={`Enlarge processed video frame ${frameIndex + 1} at ${timestamp.toFixed(1)} seconds`}
                                        title="Click to enlarge"
                                        onClick={openPreview}
                                        onKeyDown={(event) =>
                                            handlePreviewKeyDown(
                                                event,
                                                openPreview
                                            )
                                        }
                                    >
                                        <VideoFrameWithBoxes
                                            frame={frame}
                                            isRecognizedId={isRecognizedId}
                                            formatSimilarity={formatSimilarity}
                                        />

                                        <span className="preview-zoom-hint">
                                            ⤢ Click to enlarge
                                        </span>
                                    </div>

                                    <div className="recognition-card-stats">
                                        <div className="recognition-stat recognized-stat">
                                            <span>Recognized</span>
                                            <strong>
                                                {frame.recognizedCount}
                                            </strong>
                                        </div>

                                        <div className="recognition-stat unknown-stat">
                                            <span>Unknown</span>
                                            <strong>{frame.unknownCount}</strong>
                                        </div>
                                    </div>

                                    {faces.length > 0 ? (
                                        <div className="recognition-face-list">
                                            <h4>Recognition Scores</h4>

                                            {faces.map((face, faceIndex) => {
                                                const unknown =
                                                    !isRecognizedId(
                                                        face.student_id
                                                    );

                                                return (
                                                    <div
                                                        className="recognition-person-row"
                                                        key={`${frameIndex}-${faceIndex}`}
                                                    >
                                                        <div>
                                                            <span
                                                                className={
                                                                    unknown
                                                                        ? "person-status-dot unknown-dot"
                                                                        : "person-status-dot recognized-dot"
                                                                }
                                                            />

                                                            <span>
                                                                {unknown
                                                                    ? "Unknown person"
                                                                    : `Student ${face.student_id}`}
                                                            </span>
                                                        </div>

                                                        <span
                                                            className={
                                                                unknown
                                                                    ? "person-match unknown-match"
                                                                    : "person-match recognized-match"
                                                            }
                                                        >
                                                            Similarity:{" "}
                                                            {formatSimilarity(
                                                                face.similarity
                                                            )}
                                                        </span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <p className="no-faces-message">
                                            No faces detected in this frame.
                                        </p>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Enlarged recognition preview modal */}
            {enlargedPreview && (
                <div
                    className="recognition-modal-backdrop"
                    role="presentation"
                    onMouseDown={(event) => {
                        if (event.target === event.currentTarget) {
                            setEnlargedPreview(null);
                        }
                    }}
                    onTouchStart={(event) => {
                        if (event.target === event.currentTarget) {
                            event.currentTarget.dataset.backdropTouch = "true";
                        } else {
                            event.currentTarget.dataset.backdropTouch = "false";
                        }
                    }}
                    onTouchEnd={(event) => {
                        if (
                            event.currentTarget.dataset.backdropTouch ===
                                "true" &&
                            event.target === event.currentTarget
                        ) {
                            setEnlargedPreview(null);
                        }

                        delete event.currentTarget.dataset.backdropTouch;
                    }}
                    style={{
                        position: "fixed",
                        inset: 0,
                        zIndex: 10000,
                        background: "rgba(0, 0, 0, 0.88)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "24px",
                        boxSizing: "border-box",
                        overflowY: "auto",
                    }}
                >
                    <div
                        className="recognition-modal-content"
                        role="dialog"
                        aria-modal="true"
                        aria-label={enlargedPreview.title}
                        onMouseDown={(event) => event.stopPropagation()}
                        style={{
                            position: "relative",
                            width: "min(1400px, 96vw)",
                            maxHeight: "94vh",
                            display: "flex",
                            flexDirection: "column",
                            background: "#111827",
                            borderRadius: 12,
                            padding: 16,
                            boxSizing: "border-box",
                            boxShadow: "0 20px 80px rgba(0,0,0,0.5)",
                        }}
                    >
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                gap: 16,
                                marginBottom: 12,
                                color: "#ffffff",
                                flexShrink: 0,
                            }}
                        >
                            <h2
                                style={{
                                    margin: 0,
                                    fontSize: 18,
                                    lineHeight: 1.4,
                                    overflowWrap: "anywhere",
                                }}
                            >
                                {enlargedPreview.title}
                            </h2>

                            <button
                                ref={modalCloseButtonRef}
                                type="button"
                                onClick={() => setEnlargedPreview(null)}
                                aria-label="Close enlarged recognition preview"
                                title="Close (Esc)"
                                style={{
                                    flexShrink: 0,
                                    width: 44,
                                    height: 44,
                                    border: "none",
                                    borderRadius: 8,
                                    background: "#374151",
                                    color: "#ffffff",
                                    fontSize: 30,
                                    lineHeight: 1,
                                    cursor: "pointer",
                                }}
                            >
                                ×
                            </button>
                        </div>

                        <div
                            className="recognition-modal-image-area"
                            style={{
                                minHeight: 0,
                                overflow: "auto",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                borderRadius: 8,
                                background: "#030712",
                            }}
                        >
                            {enlargedPreview.type === "photo" ? (
                                <img
                                    src={enlargedPreview.imageUrl}
                                    alt={enlargedPreview.title}
                                    draggable={false}
                                    style={{
                                        display: "block",
                                        width: "auto",
                                        height: "auto",
                                        maxWidth: "100%",
                                        maxHeight: "calc(94vh - 110px)",
                                        objectFit: "contain",
                                        borderRadius: 6,
                                    }}
                                />
                            ) : (
                                <div
                                    style={{
                                        width: "100%",
                                        maxHeight: "calc(94vh - 110px)",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                    }}
                                >
                                    <div
                                        style={{
                                            width: "100%",
                                            maxHeight: "calc(94vh - 110px)",
                                        }}
                                    >
                                        <VideoFrameWithBoxes
                                            frame={enlargedPreview.frame}
                                            isRecognizedId={isRecognizedId}
                                            formatSimilarity={formatSimilarity}
                                        />
                                    </div>
                                </div>
                            )}
                        </div>

                        <p
                            style={{
                                color: "#d1d5db",
                                fontSize: 13,
                                margin: "10px 0 0",
                                flexShrink: 0,
                            }}
                        >
                            Green boxes indicate recognized students. Red
                            boxes indicate unknown people. Press Esc or click
                            × to close.
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}

export default TeacherDashboard;

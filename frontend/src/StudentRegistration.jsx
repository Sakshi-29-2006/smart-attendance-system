
import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

const API_BASE = "http://localhost:5000/api/students";

const POSES = [
  {
    key: "front",
    field: "front_photo",
    title: "Front",
    instruction: "Look straight into the camera.",
    optional: false,
  },
  {
    key: "slight_left",
    field: "slight_left_photo",
    title: "Slight left",
    instruction: "Turn your face slightly to your left.",
    optional: false,
  },
  {
    key: "slight_right",
    field: "slight_right_photo",
    title: "Slight right",
    instruction: "Turn your face slightly to your right.",
    optional: false,
  },
  {
    key: "complete_left",
    field: "complete_left_photo",
    title: "Left profile",
    instruction: "Turn farther to your left while keeping your face in frame.",
    optional: false,
  },
  {
    key: "complete_right",
    field: "complete_right_photo",
    title: "Right profile",
    instruction: "Turn farther to your right while keeping your face in frame.",
    optional: false,
  },
  {
    key: "slight_up",
    field: "slight_up_photo",
    title: "Look up",
    instruction: "Raise your chin and look slightly upward.",
    optional: false,
  },
  {
    key: "slight_down",
    field: "slight_down_photo",
    title: "Look down",
    instruction: "Lower your chin and look slightly downward.",
    optional: false,
  },
  {
    key: "without_specs",
    field: "without_specs_photo",
    title: "Without glasses",
    instruction: "If you wear glasses, remove them and look straight ahead.",
    optional: true,
  },
];

const createEmptyCaptures = () =>
  Object.fromEntries(POSES.map((pose) => [pose.key, null]));

function classifyPose(landmarks, poseKey) {
  if (!landmarks || landmarks.length < 455) {
    return {
      correct: false,
      message: "Keep your face inside the frame.",
    };
  }

  const nose = landmarks[1];
  const leftCheek = landmarks[234];
  const rightCheek = landmarks[454];
  const forehead = landmarks[10];
  const chin = landmarks[152];

  const faceWidth = Math.abs(rightCheek.x - leftCheek.x);
  const faceHeight = Math.abs(chin.y - forehead.y);

  if (faceWidth < 0.001 || faceHeight < 0.001) {
    return {
      correct: false,
      message: "Move closer to the camera.",
    };
  }

  const noseRatio =
    (nose.x - leftCheek.x) / (rightCheek.x - leftCheek.x);

  const noseVertical =
    (nose.y - forehead.y) / (chin.y - forehead.y);

  const frontal = noseRatio >= 0.43 && noseRatio <= 0.57;

  switch (poseKey) {
    case "front":
    case "without_specs":
      return frontal
        ? { correct: true, message: "Good! Hold your face straight." }
        : {
            correct: false,
            message:
              noseRatio > 0.57
                ? "Turn your face slightly to your right."
                : "Turn your face slightly to your left.",
          };

    case "slight_left":
      return noseRatio > 0.53 && noseRatio < 0.7
        ? { correct: true, message: "Good! Hold this position." }
        : {
            correct: false,
            message:
              noseRatio <= 0.53
                ? "Turn slightly to your left."
                : "Turn back a little toward the camera.",
          };

    case "slight_right":
      return noseRatio < 0.47 && noseRatio > 0.3
        ? { correct: true, message: "Good! Hold this position." }
        : {
            correct: false,
            message:
              noseRatio >= 0.47
                ? "Turn slightly to your right."
                : "Turn back a little toward the camera.",
          };

    case "complete_left":
      return noseRatio >= 0.69
        ? { correct: true, message: "Good! Hold the side angle." }
        : {
            correct: false,
            message: "Turn farther to your left.",
          };

    case "complete_right":
      return noseRatio <= 0.31
        ? { correct: true, message: "Good! Hold the side angle." }
        : {
            correct: false,
            message: "Turn farther to your right.",
          };

    case "slight_up":
      return noseVertical < 0.43
        ? { correct: true, message: "Good! Keep your chin raised." }
        : {
            correct: false,
            message: "Raise your chin and look slightly upward.",
          };

    case "slight_down":
      return noseVertical > 0.53
        ? { correct: true, message: "Good! Keep your chin lowered." }
        : {
            correct: false,
            message: "Lower your chin and look slightly downward.",
          };

    default:
      return {
        correct: false,
        message: "Follow the pose instruction.",
      };
  }
}

function StudentRegistration({ token }) {
  const [mode, setMode] = useState("register");

  const [prn, setPrn] = useState("");
  const [studentName, setStudentName] = useState("");
  const [branch, setBranch] = useState("");
  const [captures, setCaptures] = useState(createEmptyCaptures);

  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraAngle, setCameraAngle] = useState(null);

  // "user" = front camera; "environment" = back camera.
  const [cameraFacing, setCameraFacing] = useState("user");

  const [cameraReady, setCameraReady] = useState(false);
  const [modelReady, setModelReady] = useState(false);

  const [faceDetected, setFaceDetected] = useState(false);
  const [poseCorrect, setPoseCorrect] = useState(false);
  const [guidance, setGuidance] = useState("Starting camera...");
  const [holdProgress, setHoldProgress] = useState(0);

  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("");
  const [loading, setLoading] = useState(false);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const landmarkerRef = useRef(null);
  const animationRef = useRef(null);

  const cameraAngleRef = useRef(null);
  const capturesRef = useRef(captures);
  const holdStartRef = useRef(null);
  const lastFrameTimeRef = useRef(-1);
  const captureBusyRef = useRef(false);
  const inputRefs = useRef({});

  useEffect(() => {
    capturesRef.current = captures;
  }, [captures]);

  // Load MediaPipe face tracking once.
  useEffect(() => {
    let cancelled = false;

    async function loadFaceModel() {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
        );

        const landmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
            delegate: "CPU",
          },
          runningMode: "VIDEO",
          numFaces: 1,
        });

        if (cancelled) {
          landmarker.close();
          return;
        }

        landmarkerRef.current = landmarker;
        setModelReady(true);
      } catch (error) {
        console.error("Face model loading failed:", error);
        setMessage(
          "Face guidance could not load. Check your internet connection and refresh."
        );
        setMessageType("error");
      }
    }

    loadFaceModel();

    return () => {
      cancelled = true;
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
    };
  }, []);

  const stopCamera = useCallback(() => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }

    cameraAngleRef.current = null;
    holdStartRef.current = null;
    captureBusyRef.current = false;
    lastFrameTimeRef.current = -1;

    setCameraOpen(false);
    setCameraAngle(null);
    setCameraReady(false);
    setFaceDetected(false);
    setPoseCorrect(false);
    setHoldProgress(0);
  }, []);

  // Start/restart the camera when the selected camera changes.
  useEffect(() => {
    if (!cameraOpen || !modelReady) return undefined;

    let cancelled = false;
    let localStream = null;

    // Reset pose-hold state when starting or switching cameras.
    holdStartRef.current = null;
    lastFrameTimeRef.current = -1;
    setCameraReady(false);
    setFaceDetected(false);
    setPoseCorrect(false);
    setHoldProgress(0);
    setGuidance("Starting camera...");

    async function openCamera() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Camera access is unavailable in this browser.");
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: cameraFacing },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });

        localStream = stream;

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;

        const video = videoRef.current;
        if (!video) {
          stream.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
          return;
        }

        video.srcObject = stream;
        await video.play();

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        setCameraReady(true);
        setGuidance("Center your face in the frame.");

        function detectFrame() {
          if (cancelled || !videoRef.current || !landmarkerRef.current) {
            return;
          }

          const currentVideo = videoRef.current;

          if (
            currentVideo.readyState >= 2 &&
            currentVideo.videoWidth > 0 &&
            currentVideo.currentTime !== lastFrameTimeRef.current
          ) {
            lastFrameTimeRef.current = currentVideo.currentTime;

            try {
              const result = landmarkerRef.current.detectForVideo(
                currentVideo,
                performance.now()
              );

              const landmarks = result.faceLandmarks?.[0];

              if (!landmarks) {
                holdStartRef.current = null;
                setFaceDetected(false);
                setPoseCorrect(false);
                setHoldProgress(0);
                setGuidance(
                  "No face detected. Face the camera and improve lighting."
                );
              } else {
                setFaceDetected(true);

                const activePose = cameraAngleRef.current;

                if (activePose) {
                  const poseResult = classifyPose(landmarks, activePose);

                  setPoseCorrect(poseResult.correct);
                  setGuidance(poseResult.message);

                  if (poseResult.correct) {
                    if (holdStartRef.current === null) {
                      holdStartRef.current = performance.now();
                    }

                    const elapsed =
                      performance.now() - holdStartRef.current;

                    setHoldProgress(Math.min(100, (elapsed / 800) * 100));
                  } else {
                    holdStartRef.current = null;
                    setHoldProgress(0);
                  }
                }
              }
            } catch (error) {
              console.error("Face tracking error:", error);
              setGuidance("Tracking paused. Keep your face visible.");
            }
          }

          animationRef.current = requestAnimationFrame(detectFrame);
        }

        animationRef.current = requestAnimationFrame(detectFrame);
      } catch (error) {
        if (cancelled) return;

        console.error("Camera could not start:", error);

        setMessage(
          cameraFacing === "environment"
            ? "Could not open the back camera. Try the front camera or upload photos instead."
            : "Could not open the camera. Allow camera permission or upload photos instead."
        );
        setMessageType("error");

        stopCamera();
      }
    }

    openCamera();

    return () => {
      cancelled = true;

      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }

      localStream?.getTracks().forEach((track) => track.stop());

      if (streamRef.current === localStream) {
        streamRef.current = null;
      }

      const video = videoRef.current;
      if (video?.srcObject === localStream) {
        video.pause();
        video.srcObject = null;
      }
    };
  }, [cameraOpen, cameraFacing, modelReady, stopCamera]);

  // Release camera and face-model resources when the component unmounts.
  useEffect(() => {
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }

      streamRef.current?.getTracks().forEach((track) => track.stop());
      landmarkerRef.current?.close();
    };
  }, []);

  const resetForm = () => {
    const emptyCaptures = createEmptyCaptures();

    setCaptures(emptyCaptures);
    capturesRef.current = emptyCaptures;
    setPrn("");
    setStudentName("");
    setBranch("");

    Object.values(inputRefs.current).forEach((input) => {
      if (input) input.value = "";
    });
  };

  const changeMode = (nextMode) => {
    if (loading || cameraOpen) return;

    setMode(nextMode);
    resetForm();
    setMessage("");
    setMessageType("");
  };

  const startCamera = (poseKey) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMessage(
        "Camera access requires a supported browser and a secure HTTPS connection. Use photo upload instead."
      );
      setMessageType("error");
      return;
    }

    if (!modelReady) {
      setMessage("Face guidance is still loading. Please wait.");
      setMessageType("error");
      return;
    }

    setMessage("");
    setMessageType("");

    cameraAngleRef.current = poseKey;
    setCameraAngle(poseKey);
    setCameraOpen(true);
    setCameraReady(false);
    setFaceDetected(false);
    setPoseCorrect(false);
    setHoldProgress(0);
    holdStartRef.current = null;
    setGuidance("Starting camera...");
  };

  // Change the selected camera without changing the current pose.
  const switchCamera = (facing) => {
    if (facing === cameraFacing) return;

    holdStartRef.current = null;
    lastFrameTimeRef.current = -1;
    captureBusyRef.current = false;

    setCameraFacing(facing);
    setCameraReady(false);
    setFaceDetected(false);
    setPoseCorrect(false);
    setHoldProgress(0);
    setGuidance("Switching camera...");
  };

  const setCapture = (poseKey, file) => {
    setCaptures((previous) => {
      const updated = { ...previous, [poseKey]: file };
      capturesRef.current = updated;
      return updated;
    });

    setMessage("");
    setMessageType("");
  };

  const capturePhoto = () => {
    const video = videoRef.current;
    const currentPose = cameraAngleRef.current;

    if (
      !video ||
      !currentPose ||
      !cameraReady ||
      !faceDetected ||
      !poseCorrect ||
      holdProgress < 100 ||
      captureBusyRef.current
    ) {
      return;
    }

    if (!video.videoWidth || !video.videoHeight) {
      setGuidance("Camera is not ready. Please wait.");
      return;
    }

    captureBusyRef.current = true;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const context = canvas.getContext("2d");

    if (!context) {
      captureBusyRef.current = false;
      return;
    }

    // Mirror only front-camera captures. Back-camera photos should remain
    // in their natural orientation.
    if (cameraFacing === "user") {
      context.translate(canvas.width, 0);
      context.scale(-1, 1);
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        captureBusyRef.current = false;

        if (!blob) {
          setGuidance("Could not create the photo. Please try again.");
          return;
        }

        const file = new File([blob], `${currentPose}.jpg`, {
          type: "image/jpeg",
        });

        const updatedCaptures = {
          ...capturesRef.current,
          [currentPose]: file,
        };

        capturesRef.current = updatedCaptures;
        setCaptures(updatedCaptures);

        holdStartRef.current = null;
        lastFrameTimeRef.current = -1;
        setPoseCorrect(false);
        setHoldProgress(0);

        const nextRequiredPose = POSES.find(
          (pose) => !pose.optional && !updatedCaptures[pose.key]
        );

        if (nextRequiredPose) {
          cameraAngleRef.current = nextRequiredPose.key;
          setCameraAngle(nextRequiredPose.key);
          setGuidance(`Photo captured! Next: ${nextRequiredPose.title}.`);
          return;
        }

        const optionalPose = POSES.find(
          (pose) => pose.optional && !updatedCaptures[pose.key]
        );

        if (optionalPose) {
          cameraAngleRef.current = optionalPose.key;
          setCameraAngle(optionalPose.key);
          setGuidance("Required photos complete! Optional photo next.");
          return;
        }

        stopCamera();
      },
      "image/jpeg",
      0.94
    );
  };

  const handleUpload = (poseKey, event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setMessage("Please select a valid image file.");
      setMessageType("error");
      event.target.value = "";
      return;
    }

    setCapture(poseKey, file);
  };

  const removePhoto = (poseKey) => {
    setCapture(poseKey, null);

    if (inputRefs.current[poseKey]) {
      inputRefs.current[poseKey].value = "";
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    const normalizedPrn = prn.trim();

    if (!/^\d{12}$/.test(normalizedPrn)) {
      setMessage("PRN must contain exactly 12 digits.");
      setMessageType("error");
      return;
    }

    if (mode === "register" && (!studentName.trim() || !branch.trim())) {
      setMessage("Enter the student full name and branch.");
      setMessageType("error");
      return;
    }

    const missingPoses = POSES.filter(
      (pose) => !pose.optional && !captures[pose.key]
    );

    if (missingPoses.length > 0) {
      setMessage(
        `Please complete: ${missingPoses
          .map((pose) => pose.title)
          .join(", ")}.`
      );
      setMessageType("error");
      return;
    }

    const formData = new FormData();
    formData.append("prn", normalizedPrn);

    if (mode === "register") {
      formData.append("student_name", studentName.trim());
      formData.append("branch", branch.trim());
    }

    POSES.forEach((pose) => {
      const file = captures[pose.key];

      if (file) {
        formData.append(pose.field, file, file.name);
      }
    });

    const endpoint =
      mode === "register"
        ? `${API_BASE}/register`
        : `${API_BASE}/register/update`;

    setLoading(true);
    setMessage("");
    setMessageType("");

    try {
      const response = await axios.post(endpoint, formData, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const successMessage =
        response.data.message ||
        (mode === "register"
          ? "Student registered successfully."
          : "Face registration updated successfully.");

      const total = response.data.total_embeddings;
      const added = response.data.new_images_added;

      setMessage(
        mode === "update" && Number.isFinite(total)
          ? `${successMessage} Added ${added} embeddings. Total: ${total}.`
          : successMessage
      );
      setMessageType("success");

      resetForm();
    } catch (error) {
      setMessage(
        error.response?.data?.error ||
          (mode === "register"
            ? "Registration failed. Check that the backend is running."
            : "Face registration update failed. Check the backend.")
      );
      setMessageType("error");
    } finally {
      setLoading(false);
    }
  };

  const completedCount = POSES.filter(
    (pose) => !pose.optional && captures[pose.key]
  ).length;

  const activePose = POSES.find((pose) => pose.key === cameraAngle);

  return (
    <main className="registration-page guided-registration">
      <section className="registration-card registration-card-wide">
        <div className="registration-heading">
          <h1>
            {mode === "register"
              ? "Student Registration"
              : "Update Face Registration"}
          </h1>
          <p>
            {mode === "register"
              ? "Capture clear facial images to build a reliable recognition profile."
              : "Add new face images to an existing PRN without creating another student identity."}
          </p>
        </div>

        <div
          className="registration-mode-switch"
          role="group"
          aria-label="Registration mode"
        >
          <button
            type="button"
            className={mode === "register" ? "mode-button active" : "mode-button"}
            onClick={() => changeMode("register")}
            disabled={loading || cameraOpen}
          >
            Register Student
          </button>

          <button
            type="button"
            className={mode === "update" ? "mode-button active" : "mode-button"}
            onClick={() => changeMode("update")}
            disabled={loading || cameraOpen}
          >
            Update Face Registration
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="registration-identity">
            <div className="form-group">
              <label htmlFor="student-prn">PRN (12 digits)</label>
              <input
                id="student-prn"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder="Enter 12-digit PRN"
                value={prn}
                onChange={(event) =>
                  setPrn(event.target.value.replace(/\D/g, "").slice(0, 12))
                }
                pattern="[0-9]{12}"
                minLength={12}
                maxLength={12}
                title="PRN must contain exactly 12 digits."
                required
              />
              <small>{prn.length}/12 digits</small>
            </div>

            {mode === "register" && (
              <>
                <div className="form-group">
                  <label htmlFor="student-name">Full Name</label>
                  <input
                    id="student-name"
                    type="text"
                    autoComplete="name"
                    placeholder="Enter student's full name"
                    value={studentName}
                    onChange={(event) => setStudentName(event.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="student-branch">Branch</label>
                  <input
                    id="student-branch"
                    type="text"
                    placeholder="e.g. Computer Engineering"
                    value={branch}
                    onChange={(event) => setBranch(event.target.value)}
                    required
                  />
                </div>
              </>
            )}
          </div>

          {mode === "update" && (
            <p className="registration-mode-note">
              Enter the PRN of an already-registered student. New embeddings
              will be added to that student's existing face profile. Unknown
              PRNs will be rejected.
            </p>
          )}

          <div className="capture-overview">
            <div>
              <h2>Face capture</h2>
              <p>
                Follow the pose instructions. The frame turns green when your
                face matches the target pose.
              </p>
            </div>

            <div className="capture-count">
              <strong>{completedCount}/7</strong>
              <span>required poses</span>
            </div>
          </div>

          <div className="capture-progress-track">
            <span style={{ width: `${(completedCount / 7) * 100}%` }} />
          </div>

          <div className="pose-grid">
            {POSES.map((pose, index) => {
              const file = captures[pose.key];

              return (
                <article
                  key={pose.key}
                  className={`pose-card ${file ? "pose-card-complete" : ""}`}
                >
                  <div className="pose-card-top">
                    <span className="pose-number">
                      {String(index + 1).padStart(2, "0")}
                    </span>

                    <span
                      className={`pose-status ${
                        file
                          ? "pose-status-complete"
                          : pose.optional
                            ? "pose-status-optional"
                            : ""
                      }`}
                    >
                      {file
                        ? "Complete"
                        : pose.optional
                          ? "Optional"
                          : "Required"}
                    </span>
                  </div>

                  <h3>{pose.title}</h3>
                  <p className="pose-instruction">{pose.instruction}</p>

                  {file ? (
                    <div className="pose-preview">
                      <img
                        src={URL.createObjectURL(file)}
                        alt={`${pose.title} photo`}
                      />

                      <span className="pose-preview-caption">
                        <span className="pose-check">✓</span>
                        Photo selected
                      </span>

                      <button
                        type="button"
                        className="pose-remove-button"
                        onClick={() => removePhoto(pose.key)}
                      >
                        Remove photo
                      </button>
                    </div>
                  ) : (
                    <div className="pose-placeholder">
                      <span className="pose-placeholder-icon">◎</span>
                      <span>No photo captured</span>
                    </div>
                  )}

                  <div className="pose-buttons">
                    <button
                      type="button"
                      className="pose-camera-button"
                      onClick={() => startCamera(pose.key)}
                      disabled={!modelReady || loading || cameraOpen}
                    >
                      {file ? "Retake with camera" : "Use camera"}
                    </button>

                    <label className="pose-upload-button">
                      Upload photo
                      <input
                        ref={(node) => {
                          inputRefs.current[pose.key] = node;
                        }}
                        type="file"
                        accept="image/*"
                        className="pose-file-input"
                        onChange={(event) => handleUpload(pose.key, event)}
                        disabled={loading || cameraOpen}
                      />
                    </label>
                  </div>
                </article>
              );
            })}
          </div>

          <div className="registration-tips">
            <strong>For best results</strong>
            <ul>
              <li>Use even lighting and a simple background.</li>
              <li>Keep your face visible and avoid strong backlighting.</li>
              <li>Turn gradually for the side poses.</li>
              <li>The glasses-free photo is optional.</li>
            </ul>
          </div>

          <button
            type="submit"
            className="register-button"
            disabled={loading || cameraOpen}
          >
            {loading
              ? mode === "register"
                ? "Registering student..."
                : "Updating face registration..."
              : mode === "register"
                ? "Register Student"
                : "Add Face Embeddings"}
          </button>
        </form>

        {!modelReady && (
          <p className="registration-model-note">
            Loading face guidance. You can still upload photos.
          </p>
        )}

        {message && (
          <div
            className={`registration-message ${
              messageType === "success"
                ? "registration-message-success"
                : "registration-message-error"
            }`}
            role="status"
          >
            {message}
          </div>
        )}
      </section>

      {cameraOpen && activePose && (
        <div className="camera-modal" role="dialog" aria-modal="true">
          <section className="camera-card camera-card-large">
            <div className="camera-dialog-heading">
              <div>
                <span className="registration-eyebrow">GUIDED CAPTURE</span>
                <h2>{activePose.title}</h2>
                <p>Required pose {Math.min(completedCount + 1, 7)} of 7</p>
              </div>

              <button
                type="button"
                className="camera-close-button"
                onClick={stopCamera}
                aria-label="Close camera"
              >
                ×
              </button>
            </div>

            {/* Front/back camera selector */}
            <div
              className="camera-switcher"
              role="group"
              aria-label="Choose camera"
            >
              <button
                type="button"
                className={
                  cameraFacing === "user"
                    ? "camera-switch-button active"
                    : "camera-switch-button"
                }
                aria-pressed={cameraFacing === "user"}
                onClick={() => switchCamera("user")}
              >
                Front camera
              </button>

              <button
                type="button"
                className={
                  cameraFacing === "environment"
                    ? "camera-switch-button active"
                    : "camera-switch-button"
                }
                aria-pressed={cameraFacing === "environment"}
                onClick={() => switchCamera("environment")}
              >
                Back camera
              </button>
            </div>

            <p className="camera-instruction">{activePose.instruction}</p>

            <div
              className={`guided-camera-frame ${
                poseCorrect ? "guided-camera-frame-good" : ""
              }`}
            >
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                style={{
                  transform:
                    cameraFacing === "user" ? "scaleX(-1)" : "none",
                }}
              />

              <div className="face-guide-overlay" aria-hidden="true">
                <svg viewBox="0 0 300 360" preserveAspectRatio="none">
                  <path d="M150 22 C90 22 55 68 55 135 L55 185 C55 260 96 325 150 338 C204 325 245 260 245 185 L245 135 C245 68 210 22 150 22 Z" />
                  <path d="M150 6 V28 M150 332 V354 M38 180 H58 M242 180 H262" />
                </svg>
              </div>

              <div className="camera-guidance-pill">
                <span
                  className={`camera-guidance-dot ${
                    poseCorrect ? "camera-guidance-dot-good" : ""
                  }`}
                />
                {guidance}
              </div>

              {!faceDetected && cameraReady && (
                <div className="camera-face-warning">Face not detected</div>
              )}
            </div>

            <div className="camera-hold-progress">
              <div>
                <span>Hold the position</span>
                <strong>{Math.round(holdProgress)}%</strong>
              </div>

              <div className="camera-hold-track">
                <span style={{ width: `${holdProgress}%` }} />
              </div>
            </div>

            <p className="camera-live-tip">
              When the frame turns green, hold still until progress reaches
              100%. The next pose will appear automatically after capture.
            </p>

            <div className="camera-actions">
              <button
                type="button"
                className="capture-button"
                onClick={capturePhoto}
                disabled={
                  !cameraReady ||
                  !faceDetected ||
                  !poseCorrect ||
                  holdProgress < 100
                }
              >
                Capture &amp; Next Pose
              </button>

              {cameraAngle === "without_specs" && (
                <button
                  type="button"
                  className="skip-optional-button"
                  onClick={stopCamera}
                >
                  Skip optional &amp; finish
                </button>
              )}

              <button
                type="button"
                className="cancel-button"
                onClick={stopCamera}
              >
                Cancel
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

export default StudentRegistration;

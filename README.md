# Smart Attendance System Using Facial Recognition

## 1. Project Overview

The Smart Attendance System is an AI/ML-based application that automates student attendance using facial recognition. It identifies registered students from facial images and records their attendance, reducing manual effort and saving time.

## 2. Key Features

- Separate Student and Teacher Dashboards.
- Student registration with eight-pose facial capture.
- MediaPipe-based facial pose guidance.
- Face detection and recognition using InsightFace buffalo_l.
- Student identification from group photographs.
- Automatic attendance recording.
- Secure storage of facial embeddings.

## 3. Technologies Used

| Technology | Purpose |
|---|---|
| Python | Backend development |
| React.js | Frontend development |
| Flask | Backend API |
| InsightFace buffalo_l | Face detection and recognition |
| OpenCV | Image processing |
| NumPy | Facial embedding operations |
| ONNX Runtime | Model execution |
| MediaPipe Tasks Vision | Facial pose guidance |
| PostgreSQL | Structured data storage |
| Supabase Storage | Encrypted biometric storage |
| Cloudflare | Frontend hosting and backend connectivity |

## 4. System Workflow

1. Students register through the frontend.
2. MediaPipe guides students through eight different facial poses.
3. Facial images are sent to the Flask backend.
4. InsightFace detects faces and generates facial embeddings.
5. Embeddings are securely stored and associated with student IDs.
6. During attendance, the system detects faces and compares their embeddings with registered student embeddings.
7. Recognised students have their attendance recorded in the database.

## 5. Face Recognition Model

The project uses the pre-trained **InsightFace buffalo_l** model package.

- Face detection using `det_10g.onnx`.
- Facial feature extraction using `w600k_r50.onnx`.
- Facial alignment and embedding generation through InsightFace.
- Cosine similarity for comparing facial embeddings.

The model is integrated without training a new recognition model from scratch.

## 6. Deployment

- **Frontend:** Hosted on Cloudflare.
- **Backend:** Python Flask running on a local system.
- **Backend Connectivity:** Cloudflare Tunnel.
- **Database:** PostgreSQL.
- **Biometric Storage:** Supabase Storage.

**Note:** Backend-dependent features require the local Flask server and Cloudflare Tunnel to be running.

## 7. Installation and Execution

### Backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

### Frontend

Open another terminal:

```bash
cd frontend
npm install
npm run dev
```

Configure the required environment variables and database credentials before running the application.


## 8. Future Scope

- Implement liveness detection to prevent photo-based spoofing.
- Improve recognition under different lighting conditions.
- Deploy the backend on a cloud server.
- Support larger student databases.
- Introduce advanced attendance analytics.

## 9. Contributors

**Department:** Software Engineering

**Project Type:** AIML Mini Project

**Team Members:**
1. [Arya Gawas]
2. [Sakshi Mogali]
3. [Sanika Naikwade]
4. [Rakshada Jain]

---

**Project developed for academic purposes.**

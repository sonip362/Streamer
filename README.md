# Local Video Streamer

A simple Node.js application that streams a local `.mp4` video file to a web browser using HTTP Range requests (allowing for seeking/fast-forwarding).

## Setup Instructions

1. **Install Dependencies**:
   Open your terminal in the project root and run:
   ```bash
   npm install
   ```

2. **Add Your Video**:
   Place an MP4 video file in the `videos/` folder and rename it to `sample.mp4`.

3. **Run the Server**:
   ```bash
   npm start
   ```

4. **Watch the Stream**:
   Open your browser and go to `http://localhost:3000`.

## How it Works
The server uses the `express` framework to serve an HTML page. The `/video` endpoint reads the video file from the disk. If the browser requests a specific byte range (which it does for seeking), the server responds with a `206 Partial Content` status and sends only that chunk of the file.

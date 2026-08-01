var Sink = function () {

  var _fountainBuff = undefined;
  var _errBuff = undefined;
  var _errBuffSize = 1024;
  var _completed = false;

  function fountain_buff() {
    if (_fountainBuff.buffer !== Module.HEAPU8.buffer) {
      _fountainBuff = new Uint8Array(Module.HEAPU8.buffer, _fountainBuff.byteOffset, _fountainBuff.byteLength);
    }
    return _fountainBuff;
  }

  // public interface
  return {
    allocate: function () {
      const size = Module._cimbard_get_bufsize(); // max length of buff. We could also resize as we go...
      if (_fountainBuff && size > _fountainBuff.length) {
        Module._free(_fountainBuff.byteOffset);
        _fountainBuff = undefined;
      }
      if (_fountainBuff === undefined) {
        const dataPtr = Module._malloc(size);
        _fountainBuff = new Uint8Array(Module.HEAPU8.buffer, dataPtr, size);
      }
    },

    on_decode: function (buff) {
      if (_completed || buff.length == 0) { // sanity check
        return;
      }
      parent.postMessage({ source: 'qrrec-color', type: 'decoded-frame', bytes: buff.length }, location.origin);
      const fountBuff = fountain_buff();
      fountBuff.set(buff);

      console.log('sink decode ' + fountBuff); //TODO: base64?
      var res = Module._cimbard_fountain_decode(fountBuff.byteOffset, buff.length);
      console.log("on decode got res " + res);

      const report = Sink.get_report();
      if (Array.isArray(report)) {
        Recv.render_progress(report);
      }
      else {
        Recv.set_HTML("tdec", "decode " + res + ". " + report);
      }

      if (res > 0) {
        _completed = true;
        const res32t = Number(res & 0xFFFFFFFFn);; // truncate BigInt res (int64_t) to a uint32_t
        Sink.reassemble_file(res32t);
      }
    },

    get_report: function () {
      if (_errBuff === undefined) {
        _errBuff = Module._malloc(_errBuffSize);
      }
      const errlen = Module._cimbard_get_report(_errBuff, _errBuffSize);
      if (errlen > 0) {
        const errview = new Uint8Array(Module.HEAPU8.buffer, _errBuff, errlen);
        const td = new TextDecoder();
        const text = td.decode(errview);
        try {
          return JSON.parse(text);
        } catch (error) {
          return text;
        }
      }
    },

    reassemble_file: async function (id) {
      const size = Module._cimbard_get_filesize(id);
      //alert("we did it!?! " + size);
      try {
        var name = id + "." + size;
        const fnsize = Module._cimbard_get_filename(id, _errBuff, _errBuffSize);
        if (fnsize < 0) {
          alert("reassemble_file failed :(" + res);
          console.log("we biffed it. :( " + res);
          Recv.set_HTML("errorbox", "reassemble_file failed :( " + res);
        }
        else if (fnsize > 0) {
          const temparr = new Uint8Array(Module.HEAPU8.buffer, _errBuff, fnsize);
          name = new TextDecoder("utf-8").decode(temparr);
        }
        Recv.stop();
        const blob = await Zstd.decompress(name, id);
        Recv.show_result(name, blob);
        parent.postMessage({ source: 'qrrec-color', type: 'complete', name: name, bytes: blob.size, mime: blob.type || 'application/octet-stream' }, location.origin);
      } catch (error) {
        console.log("failed finish copy or download?? " + error);
        parent.postMessage({ source: 'qrrec-color', type: 'runtime-error', phase: 'decode', reason: String(error) }, location.origin);
      }
    }
  };
}();


var Recv = function () {

  var _counter = 0;
  var _recentDecode = -1;
  var _recentExtract = -1;
  var _renderTime = 0;
  var _captureNextFrame = 0;

  var _watchmanEnabled = 0;
  var _watchmanLastSeen = 1; // start at 1, can't restart if we never started

  var _video = 0;
  var _workers = [];
  var _nextWorker = 0;
  var _workerReady;
  var _framesInFlight = 0;
  var _supportedFormats = ["NV12", "I420"]; // have cimbard_* return this somehow?

  var _mode = 0;
  var _done = false;
  var _capturedFrames = 0;
  var _submittedFrames = 0;
  var _decodedFrames = 0;
  var _noDataFrames = 0;
  var _rejectedFrames = 0;
  var _errorFrames = 0;
  var _lastPipelineReport = 0;
  var _pipelineStartedAt = performance.now();
  var _lastRateAt = _pipelineStartedAt;
  var _lastRateCaptured = 0;
  var _lastRateSubmitted = 0;
  var _lastRateDecoded = 0;
  var _captureFps = 0;
  var _submitFps = 0;
  var _decodeFps = 0;
  var _droppedFrames = 0;
  var _roiWidth = 0;
  var _roiHeight = 0;
  var _pixelFormat = "unknown";
  var _cameraTrack = undefined;
  var _cameraProfile = "清晰";
  var _profileChanges = 0;
  var _lastAdaptation = performance.now();
  var _decodeTimes = [];

  function reportPipeline(force) {
    const now = performance.now();
    if (!force && now - _lastPipelineReport < 250) return;
    _lastPipelineReport = now;
    const elapsed = Math.max((now - _lastRateAt) / 1000, 0.001);
    const weight = Math.min(1, elapsed / 1.5);
    _captureFps += (((_capturedFrames - _lastRateCaptured) / elapsed) - _captureFps) * weight;
    _submitFps += (((_submittedFrames - _lastRateSubmitted) / elapsed) - _submitFps) * weight;
    _decodeTimes = _decodeTimes.filter(t => now - t <= 5000);
    _decodeFps = _decodeTimes.length / Math.min(5, Math.max((now - _pipelineStartedAt) / 1000, 1));
    _lastRateAt = now;
    _lastRateCaptured = _capturedFrames;
    _lastRateSubmitted = _submittedFrames;
    _lastRateDecoded = _decodedFrames;
    parent.postMessage({
      source: 'qrrec-color',
      type: 'pipeline-stats',
      captured: _capturedFrames,
      submitted: _submittedFrames,
      decoded: _decodedFrames,
      noData: _noDataFrames,
      rejected: _rejectedFrames,
      errors: _errorFrames,
      inFlight: _framesInFlight,
      captureFps: _captureFps,
      submitFps: _submitFps,
      decodeFps: _decodeFps,
      dropped: _droppedFrames,
      roiWidth: _roiWidth,
      roiHeight: _roiHeight,
      pixelFormat: _pixelFormat,
      cameraProfile: _cameraProfile
    }, location.origin);
  }

  async function adaptCameraProfile() {
    const now = performance.now();
    if (!_cameraTrack || _profileChanges >= 2 || now - _lastAdaptation < 6000 || _capturedFrames < 25) return;
    _lastAdaptation = now;
    const attempts = Math.max(1, _decodedFrames + _noDataFrames + _rejectedFrames);
    const locatedRatio = (_decodedFrames + _noDataFrames) / attempts;
    try {
      if (_cameraProfile === "清晰" && _captureFps < 10.5 && locatedRatio > 0.08) {
        await _cameraTrack.applyConstraints({ width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 15 } });
        _cameraProfile = "性能";
        _profileChanges += 1;
        reportPipeline(true);
      } else if (_cameraProfile === "性能" && _decodedFrames === 0 && _rejectedFrames > 30) {
        await _cameraTrack.applyConstraints({ width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 15 } });
        _cameraProfile = "清晰";
        _profileChanges += 1;
        reportPipeline(true);
      }
    } catch (error) {
      console.log("camera profile adaptation unavailable", error);
    }
  }

  function _toggleFullscreen() {
    if (document.fullscreenElement) {
      return document.exitFullscreen();
    }
    else {
      return document.documentElement.requestFullscreen();
    }
  }

  function isIOS() {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isAppleDevice = navigator.userAgent.includes('Macintosh');
    const isTouchScreen = navigator.maxTouchPoints >= 1;
    return isIOS || (isAppleDevice && isTouchScreen);
  }

  function _getModeAspectRatio(mode) {
    // (image_size_x + 16) / (image_size_y + 16)
    switch (mode) {
      case 66: return 1.1516; // Bu
      case 67: return 1.413;  // Bm
      default: return 1.0;    // B, 4C, auto
    }
  }

  function _updateCrosshairPositions() {
    if (!_video || !_video.videoWidth || !_video.videoHeight)
      return;

    var modeAspect = _getModeAspectRatio(_mode);

    var windowW = window.innerWidth;
    var windowH = window.innerHeight;
    var camAspect = _video.videoWidth / _video.videoHeight;
    var windowAspect = windowW / windowH;

    var vidW = windowW;
    var vidH = windowH;
    if (camAspect > windowAspect)  // black bars top/bottom
      vidH = vidW / camAspect;
    else  // black bars left/right
      vidW = vidH * camAspect;

    var offsetY;
    var offsetX;
    if (windowH > windowW) {
      // portrait
      offsetY = (windowH - (vidW * modeAspect)) / 2;
      offsetX = (windowW - vidW) / 2;
    }
    else {
      offsetY = (windowH - vidH) / 2;
      offsetX = (windowW - (vidH * modeAspect)) / 2;
    }

    var logme = "crosshair offsets now " + offsetX + ", " + offsetY;
    //Recv.set_error(logme);
    console.log(logme);

    var xh1 = document.getElementById("crosshair1");
    var xh2 = document.getElementById("crosshair2");
    xh1.style.top = offsetY + "px";
    xh1.style.right = offsetX + "px";
    xh2.style.bottom = offsetY + "px";
    xh2.style.left = offsetX + "px";
  }

  // public interface
  return {
    init: function (video, num_workers) {
      Recv.init_ww(num_workers);
      Recv.init_video(video);
    },

    set_error: function (msg) {
      Recv.set_HTML('errorbox', msg);
      return false;
    },

    ww_ready: new Promise(resolve => {
      _workerReady = resolve;
    }),

    frames_in_flight_incr: function () {
      _framesInFlight += 1;
      document.getElementById('framesInFlight').innerHTML = _framesInFlight;
    },

    frames_in_flight_decr: function () {
      _framesInFlight = Math.max(0, _framesInFlight - 1);
      document.getElementById('framesInFlight').innerHTML = _framesInFlight;
    },

    init_ww: function (num_workers) {
      // clean up _workers if exists?
      _workers = [];
      for (let i = 0; i < num_workers; i++) {
        _workers.push(new Worker('recv-worker.2026-07-13T0523.js'));

        _workers[i].onmessage = (event) => {
          Recv.on_decode(i, event.data);
        };

        _workers[i].onerror = (error) => {
          console.error('Worker' + i + ' error:', error);
          Recv.frames_in_flight_decr();
          _errorFrames += 1;
          reportPipeline(true);
        };
      }
    },

    init_video: function (video) {
      _done = false;
      if (_counter === 0) {
        _capturedFrames = 0;
        _submittedFrames = 0;
        _decodedFrames = 0;
        _noDataFrames = 0;
        _rejectedFrames = 0;
        _errorFrames = 0;
        _lastPipelineReport = 0;
        _pipelineStartedAt = performance.now();
        _lastRateAt = _pipelineStartedAt;
        _lastRateCaptured = 0; _lastRateSubmitted = 0; _lastRateDecoded = 0;
        _captureFps = 0; _submitFps = 0; _decodeFps = 0;
        _droppedFrames = 0; _roiWidth = 0; _roiHeight = 0; _pixelFormat = "unknown";
        _cameraProfile = "清晰"; _profileChanges = 0; _lastAdaptation = performance.now();
        _decodeTimes = [];
      }
      _video = video;
      window.addEventListener('resize', _updateCrosshairPositions);

      var constraints = {
        audio: false,
        video: {
          width: { min: 720, ideal: 1920 }, // Request HD but allow flexibility
          height: { min: 720, ideal: 1080 },
          aspectRatio: matchMedia('all and (orientation:landscape)').matches ? 16 / 9 : 9 / 16,
          facingMode: 'environment',
          exposureMode: 'continuous',
          focusMode: 'continuous',
          frameRate: { ideal: 15 }, // we're not trying to set the user's phone on fire
        }
      };

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        return Recv.set_error('mediaDevices not supported? :(');
      }

      navigator.mediaDevices.getUserMedia(constraints)
        .then(localMediaStream => {
          _cameraTrack = localMediaStream.getVideoTracks()[0];
          //console.log(localMediaStream);
          //console.dir(video);
          if ('srcObject' in video) {
            video.srcObject = localMediaStream;
          } else {
            video.src = URL.createObjectURL(localMediaStream); //deprecated
          }
          video.play();
          video.requestVideoFrameCallback(Recv.on_frame);
        })
        .catch(err => {
          console.error(`OH NO!!!!`, err);
          Recv.set_error("Failed to initialize camera. " + err);
          Recv.set_HTML("crosshair1", "Failed to initialize camera. " + err);
        });
    },

    watch_for_camera_pause: function () {
      // only call this after our first success
      if (_watchmanEnabled) {
        return;
      }
      _watchmanEnabled = true;

      // ios only for now, since desktop behavior is weird
      if (!isIOS()) {
        return;
      }

      // periodically make sure the camera capture is running
      setInterval(Recv.restart_paused_camera, 1000);
    },

    restart_paused_camera: function () {
      if (_done || !_video) {
        return;
      }

      // if we're still incrementing, do nothing
      if (_counter > _watchmanLastSeen) {
        _watchmanLastSeen = _counter;
        return;
      }

      // if not, we're stuck?
      Recv.init_video(_video);
    },

    download_bytes: function (buff, name) {
      var blob = new Blob([buff], { type: 'application/octet-stream' });
      Zstd.download_blob(name, blob);
    },

    show_result: function (name, blob) {
      const result = document.getElementById('result');
      const preview = document.getElementById('result-preview');
      const filename = document.getElementById('result-name');
      const meta = document.getElementById('result-meta');
      const save = document.getElementById('result-save');
      const url = URL.createObjectURL(blob);
      const extension = (name.split('.').pop() || '').toLowerCase();
      const imageTypes = ['png','jpg','jpeg','gif','webp','heic','bmp','svg'];
      const videoTypes = ['mp4','mov','m4v','webm'];
      const audioTypes = ['mp3','m4a','aac','wav','ogg'];

      filename.textContent = name;
      meta.textContent = (blob.size / 1024).toFixed(blob.size > 1024 * 1024 ? 0 : 1) + ' KB · 已接收完成';
      preview.replaceChildren();
      let media;
      if (imageTypes.includes(extension)) {
        media = document.createElement('img');
        media.src = url;
      } else if (videoTypes.includes(extension)) {
        media = document.createElement('video');
        media.src = url; media.controls = true; media.playsInline = true;
      } else if (audioTypes.includes(extension)) {
        media = document.createElement('audio');
        media.src = url; media.controls = true;
      } else if (extension === 'txt' || extension === 'md' || extension === 'json' || extension === 'csv') {
        media = document.createElement('pre');
        blob.text().then(text => media.textContent = text.slice(0, 200000));
      } else {
        media = document.createElement('div');
        media.className = 'file-placeholder';
        media.textContent = extension ? extension.toUpperCase() : 'FILE';
      }
      preview.appendChild(media);
      save.href = url;
      save.download = name;
      document.getElementById('container').hidden = true;
      result.hidden = false;
    },

    on_decode: function (wid, data) {
      //console.log('Main thread received message from worker' + wid + ':', data);
      // Worker readiness is not a submitted video frame. The upstream web
      // runtime decrements here before checking `ready`, starting the queue at
      // -4 with four workers and making backpressure metrics misleading.
      if (data.ready) {
        if (_workerReady)
          _workerReady();
        return;
      }
      if (_done) {
        return;
      }
      Recv.frames_in_flight_decr();
      // if extract but no bytes, log extract counte
      if (data.nodata) {
        _recentExtract = _counter;
        _noDataFrames += 1;
        reportPipeline();
        return;
      }
      if (data.failed_extract) { // very common, nothing to do
        _rejectedFrames += 1;
        reportPipeline();
        return;
      }
      if (data.res) {
        _errorFrames += 1;
        reportPipeline();
        Recv.set_HTML("t" + wid, "msg is " + data.res);
        return;
      }
      // should be a decode with some bytes, so set decodecounter
      _recentDecode = _counter;

      const buff = data.buff;
      if (!buff) {
        if (data.error) {
          _errorFrames += 1;
          reportPipeline();
          Recv.set_HTML("t" + wid, "worker returned no frame data");
        }
        return;
      }
      if (buff.length > 0) {
        _decodedFrames += 1;
        _decodeTimes.push(performance.now());
        reportPipeline(true);
        Recv.setMode(data.mode); // call *before* we send it to the sink. This is our autodetect confirm.
      }
      Recv.set_HTML("t" + wid, "mode is " + _mode + ", len() is " + buff.length + ", buff: " + buff);
      Sink.on_decode(buff);
    },

    on_frame: async function (now, metadata) {
      //console.log("on frame");
      // https://developer.mozilla.org/en-US/docs/Web/API/VideoFrame

      if (_done) return;
      _counter += 1;
      _capturedFrames += 1;
      if (_workers.length == 0)
        return;
      if (_nextWorker >= _workers.length)
        _nextWorker = 0;

      // piggyback off this call to make sure our visual state is correct
      Recv.update_visual_state();
      // make sure the camera feed stays up
      Recv.watch_for_camera_pause();
      adaptCameraProfile();

      const modeVals = [66, 68, 67, 4];

      var vf = undefined;
      if (_framesInFlight >= _workers.length) {
        _droppedFrames += 1;
        reportPipeline();
      }
      else {
        Recv.frames_in_flight_incr();
        let submitted = false;
        try {
          vf = new VideoFrame(_video, { timestamp: now });
          const width = vf.displayWidth;
          const height = vf.displayHeight;
          _pixelFormat = vf.format || "unknown";
          Recv.set_HTML("errorbox", vf.format, true);

          // try to use the default format, but only if we can decode it...
          let vfparams = {};
          if (!_supportedFormats.includes(vf.format)) {
            vfparams.format = "RGBA";
          }
          let processWidth = width;
          let processHeight = height;
          const side = Math.floor(Math.min(width, height) / 2) * 2;
          if (side >= 700 && width !== height) {
            const cropX = Math.floor((width - side) / 4) * 2;
            const cropY = Math.floor((height - side) / 4) * 2;
            vfparams.rect = { x: cropX, y: cropY, width: side, height: side };
            processWidth = side;
            processHeight = side;
          }
          let size;
          let buff;
          try {
            size = vf.allocationSize(vfparams);
            buff = new Uint8Array(size);
            await vf.copyTo(buff, vfparams);
          } catch (cropError) {
            console.log("ROI copy unavailable, falling back to full frame", cropError);
            delete vfparams.rect;
            processWidth = width;
            processHeight = height;
            size = vf.allocationSize(vfparams);
            buff = new Uint8Array(size);
            await vf.copyTo(buff, vfparams);
          }
          _roiWidth = processWidth;
          _roiHeight = processHeight;

          if (_done) {
            vf.close();
            Recv.frames_in_flight_decr();
            return;
          }

          let format = vfparams.format || vf.format;
          if (format == "RGBA" && size != processWidth * processHeight * 4) {
            format = vf.format; //fallback
          }
          if (_captureNextFrame == 1) {
            _captureNextFrame = 0;
            Recv.download_bytes(buff, processWidth + "x" + processHeight + "x" + _counter + "." + format);
          }

          let mode = _mode || modeVals[_counter % modeVals.length];
          _workers[_nextWorker].postMessage({ type: 'proc', pixels: buff, format: format, width: processWidth, height: processHeight, mode: mode }, [buff.buffer]);
          submitted = true;
          _submittedFrames += 1;
          reportPipeline();
        } catch (e) {
          console.log(e);
          _errorFrames += 1;
          reportPipeline(true);
        } finally {
          if (!submitted)
            Recv.frames_in_flight_decr();
        }
        _nextWorker += 1;
      }
      if (vf)
        vf.close();

      // schedule the next one
      if (!_done)
        _video.requestVideoFrameCallback(Recv.on_frame);
    },

    stop: function () {
      if (_done) return;
      _done = true;
      _workers.forEach(worker => worker.terminate());
      _workers = [];
      _framesInFlight = 0;
      const stream = _video && _video.srcObject;
      if (stream && stream.getTracks)
        stream.getTracks().forEach(track => track.stop());
      if (_video)
        _video.srcObject = null;
      _cameraTrack = undefined;
    },

    captureFrame: function () {
      _captureNextFrame = 1;
      alert("about to capture!");
    },

    download_bytes: function (buff, name) {
      var blob = new Blob([buff], { type: 'application/octet-stream' });
      Zstd.download_blob(name, blob);
    },

    update_visual_state: function () {
      _updateCrosshairPositions();

      // check counters
      var xh1 = document.getElementById("crosshair1");
      var xh2 = document.getElementById("crosshair2");
      if (_recentDecode > 0 && _recentDecode + 30 > _counter) {
        xh1.classList.add("active_xhairs");
        xh1.classList.remove("scanning_xhairs");
        xh2.classList.add("active_xhairs");
        xh1.classList.remove("scanning_xhairs");
      }
      else if (_recentExtract > 0 && _recentExtract + 30 > _counter) {
        xh1.classList.add("scanning_xhairs");
        xh1.classList.remove("active_xhairs");
        xh2.classList.add("scanning_xhairs");
        xh2.classList.remove("active_xhairs");
      }
      else { // inactive
        xh1.classList.remove("active_xhairs");
        xh1.classList.remove("scanning_xhairs");
        xh2.classList.remove("active_xhairs");
        xh2.classList.remove("scanning_xhairs");
      }
    },

    render_progress: function (report) {
      console.log("progress!!!!" + report);
      Recv.set_HTML("tdec", "progress " + report);
      parent.postMessage({ source: 'qrrec-color', type: 'progress', values: report }, location.origin);
      const progress_container = document.getElementById('progress_bars');
      const query = '#progress_bars > div[class="progress"]';
      const prev = document.querySelectorAll(query);

      if (!prev || prev.length < report.length) {
        for (var i = (prev ? prev.length : 0); i < report.length; i++) {
          var aaa = document.createElement('div');
          aaa.classList.add("progress");
          progress_container.appendChild(aaa);
        }
      }
      else if (report.length < prev.length) {
        for (var i = report.length; i < prev.length; i++) {
          prev[i].remove();
        }
      }

      const current = document.querySelectorAll(query);
      if (current) {
        console.log(current.length);
      }
      for (var i = 0; i < report.length; i++) {
        console.log(report[i] * 100 + "%");
        current[i].style.width = report[i] * 100 + "%";
      }
    },

    toggleFullscreen: function () {
      _toggleFullscreen();
    },

    showDebug: function () {
      document.getElementById("debug-button").focus();
    },

    clickNav: function () {
      document.getElementById("nav-button").focus();
    },

    blurNav: function (pause) {
      if (pause === undefined) {
        pause = true;
      }
      document.getElementById("nav-button").blur();
      document.getElementById("nav-content").blur();
    },

    setMode: function (modeVal) {
      // these should be moved elsewhere...
      const modeToString = {
        4: "4C",
        8: "8C",
        66: "Bu",
        67: "Bm",
        68: "B"
      };
      let modeStringToVal = {
        "Auto": 0
      };
      for (const val in modeToString) {
        modeStringToVal[modeToString[val]] = val;
      }

      if (modeVal in modeStringToVal) {
        modeVal = modeStringToVal[modeVal];
      }

      // configure wasm in main thread
      _mode = modeVal;
      if (_mode > 0) {
        Module._cimbard_configure_decode(_mode);
        Sink.allocate();
      }

      // update ui
      if (_mode > 0) {
        var nav = document.getElementById("mode-val");
        nav.innerHTML = modeToString[_mode];
      }

      var nav = document.getElementById("nav-container");
      if (_mode == 0) {
        nav.classList.add("mode-auto");
        nav.classList.remove("mode-b");
      } else {
        nav.classList.add("mode-b");
        nav.classList.remove("mode-auto");
      }
    },

    set_HTML: function (id, msg, only_if_unset) {
      const elem = document.getElementById(id);
      if (only_if_unset && elem.innerHTML) {
        return;
      }
      elem.innerHTML = msg;
    },

    set_title: function (msg) {
      document.title = "Cimbar: " + msg;
    }
  };
}();

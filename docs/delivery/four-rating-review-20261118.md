# Mandatory four-rating review

The user's18 November2026 requirement supersedes R22's optional four-button design: Q/A reviews always show Again, Hard, Good and Easy. New installs and devices with a saved `fourButtons:false` must have the same four choices. Settings no longer offers a two-button mode.

The existing four-rating callbacks and FSRS scheduler are retained. Again means failed recall; Hard means correct recall with difficulty; Good means normal recall; Easy means effortless recall. A revealed answer being understandable does not establish successful recall. Current Help explains this distinction.

The obsolete preference module is removed. Its old storage key is left unused; this update neither rewrites historical review ratings nor resets learning progress. First-exposure teaching and MCQ verdict controls keep their existing paths; this change concerns Q/A review self-ratings.

Main retains its2.1.1 runtime boundary. The authorized iOS2.1.0/build25 OTA is built from last verified production source `ff4a8bac7c916fcaa12f90f531866fe3f9ee3c5a`, with only this focused patch. App/native/package/queue/FSRS inputs remain unchanged. Release and physical-phone receipts are saved under `exports/four-rating-review-20261118/`; publication is confirmed only by those receipts. Sentry maintenance is deferred at the user's request.

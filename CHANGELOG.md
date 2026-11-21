# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **A rate limit from Twilio no longer counts as Twilio being down.** In 0.2.0, a
  429 other than two per-number codes threw `TwilioUnavailableError`. But Twilio
  answers 429 for limits on one number, such as too many concurrent requests
  for it (60212), and even its account-wide 20429 can be caused by repeated
  requests to one number. So anyone could make one number look like an outage,
  and an app that answers outages differently could reveal whether that number
  has an account. Every 429 now returns `false`, like any other refusal of one
  recipient. Only network failures, bad credentials, a missing Verify Service
  and Twilio server errors throw.

## [0.2.0] - 2026-11-21

### Changed

- **Breaking: an outage at Twilio now throws instead of returning `false`.** Sending
  or checking a code throws a new `TwilioUnavailableError` when Twilio can't serve
  anyone right now. That covers a network failure, bad credentials, a missing Verify
  Service, an account-wide rate limit, and a Twilio server error. Your app can then
  tell people to try again shortly, instead of saying a code is on its way or that a
  correct code is wrong. A refusal about one number or one code still returns `false`:
  an invalid number, a landline, a blocked country, too many attempts for that
  number, or a wrong or expired code.
- The error, and the warnings the client logs, include the HTTP status and Twilio's
  numeric error code, so you can see why a send failed. Twilio's error message is
  still never read or logged, because it can include the phone number or email
  address.

## [0.1.1] - 2026-04-09

### Changed

- Republished to verify the npm trusted-publisher setup. No code changes.

## [0.1.0] - 2026-04-09

### Added

- First release: a small client for sending and checking Twilio Verify codes by
  SMS or email, with no global state and no environment variables.

[Unreleased]: https://github.com/mabulu-inc/simplicity-twilio/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/mabulu-inc/simplicity-twilio/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/mabulu-inc/simplicity-twilio/compare/bcdd716...v0.1.1
[0.1.0]: https://github.com/mabulu-inc/simplicity-twilio/commit/bcdd716

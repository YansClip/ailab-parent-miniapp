/* Project-owned compile-only checks against separately supplied official headers.
 * No main(), SDK initialization, network, credentials, media or file writes.
 * Do not link/run the original SDK examples as part of this check. */
#include <time.h>
#include "wmpf/cloudvoip_server.h"
#include "wmpf/hardware/audio.h"
#include "wmpf/hardware/camera.h"

typedef wx_operation_t (*join_fn)(wx_cloudvoip_session_type_t,
    const struct wx_cloudvoip_session_listener *, void *,
    const char *, const char *, const char *, const char *, const char *,
    wx_cloudvoip_session_t *);
typedef wx_operation_t (*hangup_fn)(wx_cloudvoip_session_t,
    wx_cloudvoip_hangup_reason_t);
typedef wx_operation_t (*listener_hangup_fn)(const char *, const char *,
    const char *, const char *, const char *, wx_cloudvoip_hangup_reason_t);

void verify_official_header_contract(void) {
  join_fn device_originated = &wx_cloudvoip_session_join;
  join_fn phone_originated = &wx_cloudvoip_session_cloud_call_join;
  hangup_fn active_hangup = &wx_cloudvoip_session_hangup;
  listener_hangup_fn before_join = &wx_cloudvoip_listener_hangup;
  void (*destroy)(wx_cloudvoip_session_t) = &wx_cloudvoip_session_destroy;
  (void)device_originated; (void)phone_originated; (void)active_hangup;
  (void)before_join; (void)destroy;
}

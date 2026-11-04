/**
 * This file was generated from the SQLite schema source.
 * Please do not edit it manually.
 */

export const OPENCLAW_STATE_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS auth_profile_stores (
  store_key TEXT NOT NULL PRIMARY KEY,
  store_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_profile_state (
  store_key TEXT NOT NULL PRIMARY KEY,
  state_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS diagnostic_events (
  scope TEXT NOT NULL,
  event_key TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (scope, event_key)
);

CREATE INDEX IF NOT EXISTS idx_diagnostic_events_scope_created
  ON diagnostic_events(scope, created_at, event_key);

CREATE TABLE IF NOT EXISTS diagnostic_stability_bundles (
  bundle_key TEXT NOT NULL PRIMARY KEY,
  reason TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  bundle_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_diagnostic_stability_bundles_created
  ON diagnostic_stability_bundles(created_at DESC, bundle_key);

CREATE TABLE IF NOT EXISTS state_leases (
  scope TEXT NOT NULL,
  lease_key TEXT NOT NULL,
  owner TEXT NOT NULL,
  expires_at INTEGER,
  heartbeat_at INTEGER,
  payload_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (scope, lease_key)
);

CREATE INDEX IF NOT EXISTS idx_state_leases_expiry
  ON state_leases(expires_at, scope, lease_key)
  WHERE expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_state_leases_owner
  ON state_leases(owner, updated_at DESC);

CREATE TABLE IF NOT EXISTS exec_approvals_config (
  config_key TEXT NOT NULL PRIMARY KEY,
  raw_json TEXT NOT NULL,
  socket_path TEXT,
  has_socket_token INTEGER NOT NULL,
  default_security TEXT,
  default_ask TEXT,
  default_ask_fallback TEXT,
  auto_allow_skills INTEGER,
  agent_count INTEGER NOT NULL,
  allowlist_count INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_meta (
  meta_key TEXT NOT NULL PRIMARY KEY,
  role TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  agent_id TEXT,
  app_version TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS device_pairing_pending (
  request_id TEXT NOT NULL PRIMARY KEY,
  device_id TEXT NOT NULL,
  public_key TEXT NOT NULL,
  display_name TEXT,
  platform TEXT,
  device_family TEXT,
  client_id TEXT,
  client_mode TEXT,
  role TEXT,
  roles_json TEXT,
  scopes_json TEXT,
  remote_ip TEXT,
  silent INTEGER,
  is_repair INTEGER,
  ts INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_device_pairing_pending_device
  ON device_pairing_pending(device_id, ts DESC);

CREATE TABLE IF NOT EXISTS device_pairing_paired (
  device_id TEXT NOT NULL PRIMARY KEY,
  public_key TEXT NOT NULL,
  display_name TEXT,
  platform TEXT,
  device_family TEXT,
  client_id TEXT,
  client_mode TEXT,
  role TEXT,
  roles_json TEXT,
  scopes_json TEXT,
  approved_scopes_json TEXT,
  remote_ip TEXT,
  tokens_json TEXT,
  created_at_ms INTEGER NOT NULL,
  approved_at_ms INTEGER NOT NULL,
  last_seen_at_ms INTEGER,
  last_seen_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_device_pairing_paired_approved
  ON device_pairing_paired(approved_at_ms DESC, device_id);

CREATE TABLE IF NOT EXISTS device_bootstrap_tokens (
  token_key TEXT NOT NULL PRIMARY KEY,
  token TEXT NOT NULL,
  ts INTEGER NOT NULL,
  device_id TEXT,
  public_key TEXT,
  profile_json TEXT,
  redeemed_profile_json TEXT,
  pending_profile_json TEXT,
  issued_at_ms INTEGER NOT NULL,
  last_used_at_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_device_bootstrap_tokens_ts
  ON device_bootstrap_tokens(ts);

CREATE TABLE IF NOT EXISTS node_pairing_pending (
  request_id TEXT NOT NULL PRIMARY KEY,
  node_id TEXT NOT NULL,
  display_name TEXT,
  platform TEXT,
  version TEXT,
  core_version TEXT,
  ui_version TEXT,
  device_family TEXT,
  model_identifier TEXT,
  client_id TEXT,
  client_mode TEXT,
  caps_json TEXT,
  commands_json TEXT,
  permissions_json TEXT,
  remote_ip TEXT,
  silent INTEGER,
  ts INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_node_pairing_pending_node
  ON node_pairing_pending(node_id, ts DESC);

CREATE TABLE IF NOT EXISTS node_pairing_paired (
  node_id TEXT NOT NULL PRIMARY KEY,
  token TEXT NOT NULL,
  display_name TEXT,
  platform TEXT,
  version TEXT,
  core_version TEXT,
  ui_version TEXT,
  device_family TEXT,
  model_identifier TEXT,
  client_id TEXT,
  client_mode TEXT,
  caps_json TEXT,
  commands_json TEXT,
  permissions_json TEXT,
  remote_ip TEXT,
  bins_json TEXT,
  created_at_ms INTEGER NOT NULL,
  approved_at_ms INTEGER NOT NULL,
  last_connected_at_ms INTEGER,
  last_seen_at_ms INTEGER,
  last_seen_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_node_pairing_paired_approved
  ON node_pairing_paired(approved_at_ms DESC, node_id);

CREATE TABLE IF NOT EXISTS device_identities (
  identity_key TEXT NOT NULL PRIMARY KEY,
  device_id TEXT NOT NULL,
  public_key_pem TEXT NOT NULL,
  private_key_pem TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_device_identities_device
  ON device_identities(device_id, updated_at_ms DESC);

CREATE TABLE IF NOT EXISTS device_auth_tokens (
  device_id TEXT NOT NULL,
  role TEXT NOT NULL,
  token TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (device_id, role)
);

CREATE INDEX IF NOT EXISTS idx_device_auth_tokens_updated
  ON device_auth_tokens(updated_at_ms DESC, device_id, role);

CREATE TABLE IF NOT EXISTS android_notification_recent_packages (
  package_name TEXT NOT NULL PRIMARY KEY,
  sort_order INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_android_notification_recent_packages_order
  ON android_notification_recent_packages(sort_order, package_name);

CREATE TABLE IF NOT EXISTS macos_port_guardian_records (
  pid INTEGER NOT NULL PRIMARY KEY,
  port INTEGER NOT NULL,
  command TEXT NOT NULL,
  mode TEXT NOT NULL,
  timestamp REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_macos_port_guardian_records_port
  ON macos_port_guardian_records(port, timestamp DESC);

CREATE TABLE IF NOT EXISTS workspace_setup_state (
  workspace_key TEXT NOT NULL PRIMARY KEY,
  workspace_path TEXT NOT NULL,
  version INTEGER NOT NULL,
  bootstrap_seeded_at TEXT,
  setup_completed_at TEXT,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workspace_setup_state_path
  ON workspace_setup_state(workspace_path);

CREATE TABLE IF NOT EXISTS native_hook_relay_bridges (
  relay_id TEXT NOT NULL PRIMARY KEY,
  pid INTEGER NOT NULL,
  hostname TEXT NOT NULL,
  port INTEGER NOT NULL,
  token TEXT NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_native_hook_relay_bridges_expires
  ON native_hook_relay_bridges(expires_at_ms, relay_id);

CREATE TABLE IF NOT EXISTS model_capability_cache (
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  name TEXT NOT NULL,
  input_text INTEGER NOT NULL,
  input_image INTEGER NOT NULL,
  reasoning INTEGER NOT NULL,
  supports_tools INTEGER,
  context_window INTEGER NOT NULL,
  max_tokens INTEGER NOT NULL,
  cost_input REAL NOT NULL,
  cost_output REAL NOT NULL,
  cost_cache_read REAL NOT NULL,
  cost_cache_write REAL NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (provider_id, model_id)
);

CREATE INDEX IF NOT EXISTS idx_model_capability_cache_provider_updated
  ON model_capability_cache(provider_id, updated_at_ms DESC, model_id);

CREATE TABLE IF NOT EXISTS agent_model_catalogs (
  catalog_key TEXT NOT NULL PRIMARY KEY,
  agent_dir TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_model_catalogs_agent_dir
  ON agent_model_catalogs(agent_dir, updated_at DESC);

CREATE TABLE IF NOT EXISTS managed_outgoing_image_records (
  attachment_id TEXT NOT NULL PRIMARY KEY,
  session_key TEXT NOT NULL,
  message_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  retention_class TEXT,
  alt TEXT NOT NULL,
  original_media_id TEXT NOT NULL,
  original_media_subdir TEXT NOT NULL,
  original_content_type TEXT NOT NULL,
  original_width INTEGER,
  original_height INTEGER,
  original_size_bytes INTEGER,
  original_filename TEXT,
  record_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_managed_outgoing_images_session
  ON managed_outgoing_image_records(session_key, created_at DESC, attachment_id);

CREATE INDEX IF NOT EXISTS idx_managed_outgoing_images_message
  ON managed_outgoing_image_records(session_key, message_id, attachment_id)
  WHERE message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS channel_pairing_requests (
  channel_key TEXT NOT NULL,
  account_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  code TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  meta_json TEXT,
  PRIMARY KEY (channel_key, account_id, request_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_pairing_requests_code
  ON channel_pairing_requests(channel_key, code);

CREATE INDEX IF NOT EXISTS idx_channel_pairing_requests_created
  ON channel_pairing_requests(channel_key, created_at, request_id);

CREATE TABLE IF NOT EXISTS channel_pairing_allow_entries (
  channel_key TEXT NOT NULL,
  account_id TEXT NOT NULL,
  entry TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (channel_key, account_id, entry)
);

CREATE INDEX IF NOT EXISTS idx_channel_pairing_allow_account
  ON channel_pairing_allow_entries(channel_key, account_id, sort_order, entry);

CREATE TABLE IF NOT EXISTS web_push_subscriptions (
  endpoint_hash TEXT NOT NULL PRIMARY KEY,
  subscription_id TEXT NOT NULL UNIQUE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_web_push_subscriptions_updated
  ON web_push_subscriptions(updated_at_ms DESC, subscription_id);

CREATE TABLE IF NOT EXISTS web_push_vapid_keys (
  key_id TEXT NOT NULL PRIMARY KEY,
  public_key TEXT NOT NULL,
  private_key TEXT NOT NULL,
  subject TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS apns_registrations (
  node_id TEXT NOT NULL PRIMARY KEY,
  transport TEXT NOT NULL,
  token TEXT,
  relay_handle TEXT,
  send_grant TEXT,
  installation_id TEXT,
  topic TEXT NOT NULL,
  environment TEXT NOT NULL,
  distribution TEXT,
  token_debug_suffix TEXT,
  updated_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_apns_registrations_updated
  ON apns_registrations(updated_at_ms DESC, node_id);

CREATE TABLE IF NOT EXISTS node_host_config (
  config_key TEXT NOT NULL PRIMARY KEY,
  version INTEGER NOT NULL,
  node_id TEXT NOT NULL,
  token TEXT,
  display_name TEXT,
  gateway_host TEXT,
  gateway_port INTEGER,
  gateway_tls INTEGER,
  gateway_tls_fingerprint TEXT,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS voicewake_triggers (
  config_key TEXT NOT NULL,
  position INTEGER NOT NULL,
  trigger TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (config_key, position)
);

CREATE INDEX IF NOT EXISTS idx_voicewake_triggers_trigger
  ON voicewake_triggers(config_key, trigger);

CREATE TABLE IF NOT EXISTS voicewake_routing_config (
  config_key TEXT NOT NULL PRIMARY KEY,
  version INTEGER NOT NULL,
  default_target_mode TEXT NOT NULL,
  default_target_agent_id TEXT,
  default_target_session_key TEXT,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS voicewake_routing_routes (
  config_key TEXT NOT NULL,
  position INTEGER NOT NULL,
  trigger TEXT NOT NULL,
  target_mode TEXT NOT NULL,
  target_agent_id TEXT,
  target_session_key TEXT,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (config_key, position),
  FOREIGN KEY (config_key) REFERENCES voicewake_routing_config(config_key) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_voicewake_routing_routes_trigger
  ON voicewake_routing_routes(config_key, trigger);

CREATE TABLE IF NOT EXISTS update_check_state (
  state_key TEXT NOT NULL PRIMARY KEY,
  last_checked_at TEXT,
  last_notified_version TEXT,
  last_notified_tag TEXT,
  last_available_version TEXT,
  last_available_tag TEXT,
  auto_install_id TEXT,
  auto_first_seen_version TEXT,
  auto_first_seen_tag TEXT,
  auto_first_seen_at TEXT,
  auto_last_attempt_version TEXT,
  auto_last_attempt_at TEXT,
  auto_last_success_version TEXT,
  auto_last_success_at TEXT,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS config_health_entries (
  config_path TEXT NOT NULL PRIMARY KEY,
  last_known_good_json TEXT,
  last_promoted_good_json TEXT,
  last_observed_suspicious_signature TEXT,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS installed_plugin_index (
  index_key TEXT NOT NULL PRIMARY KEY,
  version INTEGER NOT NULL,
  host_contract_version TEXT NOT NULL,
  compat_registry_version TEXT NOT NULL,
  migration_version INTEGER NOT NULL,
  policy_hash TEXT NOT NULL,
  generated_at_ms INTEGER NOT NULL,
  refresh_reason TEXT,
  install_records_json TEXT NOT NULL,
  plugins_json TEXT NOT NULL,
  diagnostics_json TEXT NOT NULL,
  warning TEXT,
  updated_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_installed_plugin_index_generated
  ON installed_plugin_index(generated_at_ms DESC, index_key);

CREATE TABLE IF NOT EXISTS gateway_restart_sentinel (
  sentinel_key TEXT NOT NULL PRIMARY KEY,
  version INTEGER NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  ts INTEGER NOT NULL,
  session_key TEXT,
  thread_id TEXT,
  delivery_channel TEXT,
  delivery_to TEXT,
  delivery_account_id TEXT,
  message TEXT,
  continuation_json TEXT,
  doctor_hint TEXT,
  stats_json TEXT,
  payload_json TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gateway_restart_sentinel_ts
  ON gateway_restart_sentinel(ts DESC, sentinel_key);

CREATE TABLE IF NOT EXISTS gateway_restart_intent (
  intent_key TEXT NOT NULL PRIMARY KEY,
  kind TEXT NOT NULL,
  pid INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  reason TEXT,
  force INTEGER,
  wait_ms INTEGER,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS gateway_restart_handoff (
  handoff_key TEXT NOT NULL PRIMARY KEY,
  kind TEXT NOT NULL,
  version INTEGER NOT NULL,
  intent_id TEXT NOT NULL,
  pid INTEGER NOT NULL,
  process_instance_id TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  reason TEXT,
  restart_trace_started_at INTEGER,
  restart_trace_last_at INTEGER,
  source TEXT NOT NULL,
  restart_kind TEXT NOT NULL,
  supervisor_mode TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gateway_restart_handoff_expiry
  ON gateway_restart_handoff(expires_at, pid);

CREATE TABLE IF NOT EXISTS acp_sessions (
  session_key TEXT NOT NULL PRIMARY KEY,
  session_id TEXT,
  backend TEXT NOT NULL,
  agent TEXT NOT NULL,
  runtime_session_name TEXT NOT NULL,
  identity_json TEXT,
  mode TEXT NOT NULL,
  runtime_options_json TEXT,
  cwd TEXT,
  state TEXT NOT NULL,
  last_activity_at INTEGER NOT NULL,
  last_error TEXT,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_acp_sessions_state_activity
  ON acp_sessions(state, last_activity_at DESC, session_key);

CREATE INDEX IF NOT EXISTS idx_acp_sessions_agent_activity
  ON acp_sessions(agent, last_activity_at DESC, session_key);

CREATE TABLE IF NOT EXISTS acp_replay_sessions (
  session_id TEXT NOT NULL PRIMARY KEY,
  session_key TEXT NOT NULL,
  cwd TEXT NOT NULL,
  complete INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  next_seq INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_acp_replay_sessions_key_updated
  ON acp_replay_sessions(session_key, complete, updated_at DESC, session_id);

CREATE INDEX IF NOT EXISTS idx_acp_replay_sessions_updated
  ON acp_replay_sessions(updated_at DESC, session_id);

CREATE TABLE IF NOT EXISTS acp_replay_events (
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  at INTEGER NOT NULL,
  session_key TEXT NOT NULL,
  run_id TEXT,
  update_json TEXT NOT NULL,
  PRIMARY KEY (session_id, seq),
  FOREIGN KEY (session_id) REFERENCES acp_replay_sessions(session_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_acp_replay_events_session_seq
  ON acp_replay_events(session_id, seq);

CREATE TABLE IF NOT EXISTS agent_databases (
  agent_id TEXT NOT NULL,
  path TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  size_bytes INTEGER,
  PRIMARY KEY (agent_id, path)
);

CREATE TABLE IF NOT EXISTS plugin_state_entries (
  plugin_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  entry_key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  PRIMARY KEY (plugin_id, namespace, entry_key)
);

CREATE INDEX IF NOT EXISTS idx_plugin_state_expiry
  ON plugin_state_entries(expires_at)
  WHERE expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_plugin_state_listing
  ON plugin_state_entries(plugin_id, namespace, created_at, entry_key);

CREATE TABLE IF NOT EXISTS channel_ingress_events (
  queue_name TEXT NOT NULL,
  event_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  status TEXT NOT NULL,
  lane_key TEXT,
  payload_json TEXT NOT NULL,
  metadata_json TEXT,
  received_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  claim_token TEXT,
  claim_owner TEXT,
  claimed_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at INTEGER,
  last_error TEXT,
  failed_reason TEXT,
  failed_at INTEGER,
  completed_at INTEGER,
  completed_metadata_json TEXT,
  PRIMARY KEY (queue_name, event_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_ingress_pending
  ON channel_ingress_events(queue_name, status, received_at, event_id);

CREATE INDEX IF NOT EXISTS idx_channel_ingress_claims
  ON channel_ingress_events(queue_name, status, claimed_at);

CREATE INDEX IF NOT EXISTS idx_channel_ingress_lane
  ON channel_ingress_events(queue_name, status, lane_key);

CREATE TABLE IF NOT EXISTS plugin_blob_entries (
  plugin_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  entry_key TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  blob BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  PRIMARY KEY (plugin_id, namespace, entry_key)
);

CREATE INDEX IF NOT EXISTS idx_plugin_blob_expiry
  ON plugin_blob_entries(expires_at)
  WHERE expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_plugin_blob_listing
  ON plugin_blob_entries(plugin_id, namespace, created_at, entry_key);

CREATE TABLE IF NOT EXISTS media_blobs (
  subdir TEXT NOT NULL,
  id TEXT NOT NULL,
  content_type TEXT,
  size_bytes INTEGER NOT NULL,
  blob BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (subdir, id)
);

CREATE INDEX IF NOT EXISTS idx_media_blobs_created
  ON media_blobs(created_at);

CREATE TABLE IF NOT EXISTS skill_uploads (
  upload_id TEXT NOT NULL PRIMARY KEY,
  kind TEXT NOT NULL,
  slug TEXT NOT NULL,
  force INTEGER NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT,
  actual_sha256 TEXT,
  received_bytes INTEGER NOT NULL,
  archive_blob BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  committed INTEGER NOT NULL,
  committed_at INTEGER,
  idempotency_key_hash TEXT UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_skill_uploads_expiry
  ON skill_uploads(expires_at);

CREATE INDEX IF NOT EXISTS idx_skill_uploads_idempotency
  ON skill_uploads(idempotency_key_hash)
  WHERE idempotency_key_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS capture_sessions (
  id TEXT NOT NULL PRIMARY KEY,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  mode TEXT NOT NULL,
  source_scope TEXT NOT NULL,
  source_process TEXT NOT NULL,
  proxy_url TEXT
);

CREATE TABLE IF NOT EXISTS capture_blobs (
  blob_id TEXT NOT NULL PRIMARY KEY,
  content_type TEXT,
  encoding TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  data BLOB NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS capture_events (
  id INTEGER NOT NULL PRIMARY KEY,
  session_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  source_scope TEXT NOT NULL,
  source_process TEXT NOT NULL,
  protocol TEXT NOT NULL,
  direction TEXT NOT NULL,
  kind TEXT NOT NULL,
  flow_id TEXT NOT NULL,
  method TEXT,
  host TEXT,
  path TEXT,
  status INTEGER,
  close_code INTEGER,
  content_type TEXT,
  headers_json TEXT,
  data_text TEXT,
  data_blob_id TEXT,
  data_sha256 TEXT,
  error_text TEXT,
  meta_json TEXT,
  FOREIGN KEY (session_id) REFERENCES capture_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (data_blob_id) REFERENCES capture_blobs(blob_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS capture_events_session_ts_idx
  ON capture_events(session_id, ts);

CREATE INDEX IF NOT EXISTS capture_events_flow_idx
  ON capture_events(flow_id, ts);

CREATE TABLE IF NOT EXISTS sandbox_registry_entries (
  registry_kind TEXT NOT NULL,
  container_name TEXT NOT NULL,
  session_key TEXT,
  backend_id TEXT,
  runtime_label TEXT,
  image TEXT,
  created_at_ms INTEGER,
  last_used_at_ms INTEGER,
  config_label_kind TEXT,
  config_hash TEXT,
  cdp_port INTEGER,
  no_vnc_port INTEGER,
  entry_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (registry_kind, container_name)
);

CREATE INDEX IF NOT EXISTS idx_sandbox_registry_updated
  ON sandbox_registry_entries(registry_kind, updated_at DESC, container_name);

CREATE INDEX IF NOT EXISTS idx_sandbox_registry_session
  ON sandbox_registry_entries(registry_kind, session_key, last_used_at_ms DESC, container_name)
  WHERE session_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sandbox_registry_last_used
  ON sandbox_registry_entries(registry_kind, last_used_at_ms DESC, container_name)
  WHERE last_used_at_ms IS NOT NULL;

CREATE TABLE IF NOT EXISTS commitments (
  id TEXT NOT NULL PRIMARY KEY,
  agent_id TEXT NOT NULL,
  session_key TEXT NOT NULL,
  channel TEXT NOT NULL,
  account_id TEXT,
  recipient_id TEXT,
  thread_id TEXT,
  sender_id TEXT,
  kind TEXT NOT NULL,
  sensitivity TEXT NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT NOT NULL,
  suggested_text TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  confidence REAL NOT NULL,
  due_earliest_ms INTEGER NOT NULL,
  due_latest_ms INTEGER NOT NULL,
  due_timezone TEXT NOT NULL,
  source_message_id TEXT,
  source_run_id TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  attempts INTEGER NOT NULL,
  last_attempt_at_ms INTEGER,
  sent_at_ms INTEGER,
  dismissed_at_ms INTEGER,
  snoozed_until_ms INTEGER,
  expired_at_ms INTEGER,
  record_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_commitments_scope_due
  ON commitments(agent_id, session_key, status, due_earliest_ms, due_latest_ms);

CREATE INDEX IF NOT EXISTS idx_commitments_status_due
  ON commitments(status, due_earliest_ms, due_latest_ms);

CREATE INDEX IF NOT EXISTS idx_commitments_scope_dedupe
  ON commitments(agent_id, session_key, channel, dedupe_key, status);

CREATE TABLE IF NOT EXISTS cron_run_logs (
  store_key TEXT NOT NULL,
  job_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  status TEXT,
  error TEXT,
  summary TEXT,
  diagnostics_summary TEXT,
  delivery_status TEXT,
  delivery_error TEXT,
  delivered INTEGER,
  session_id TEXT,
  session_key TEXT,
  run_id TEXT,
  run_at_ms INTEGER,
  duration_ms INTEGER,
  next_run_at_ms INTEGER,
  model TEXT,
  provider TEXT,
  total_tokens INTEGER,
  entry_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (store_key, job_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_cron_run_logs_store_ts
  ON cron_run_logs(store_key, ts DESC, seq DESC);

CREATE INDEX IF NOT EXISTS idx_cron_run_logs_job_status
  ON cron_run_logs(store_key, job_id, status, ts DESC, seq DESC);

CREATE INDEX IF NOT EXISTS idx_cron_run_logs_delivery
  ON cron_run_logs(store_key, delivery_status, ts DESC, seq DESC)
  WHERE delivery_status IS NOT NULL;

CREATE TABLE IF NOT EXISTS cron_jobs (
  store_key TEXT NOT NULL,
  job_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  enabled INTEGER NOT NULL,
  delete_after_run INTEGER,
  created_at_ms INTEGER NOT NULL,
  agent_id TEXT,
  session_key TEXT,
  schedule_kind TEXT NOT NULL,
  schedule_expr TEXT,
  schedule_tz TEXT,
  every_ms INTEGER,
  anchor_ms INTEGER,
  at TEXT,
  stagger_ms INTEGER,
  session_target TEXT NOT NULL,
  wake_mode TEXT NOT NULL,
  payload_kind TEXT NOT NULL,
  payload_message TEXT,
  payload_model TEXT,
  payload_fallbacks_json TEXT,
  payload_thinking TEXT,
  payload_timeout_seconds INTEGER,
  payload_allow_unsafe_external_content INTEGER,
  payload_external_content_source_json TEXT,
  payload_light_context INTEGER,
  payload_tools_allow_json TEXT,
  delivery_mode TEXT,
  delivery_channel TEXT,
  delivery_to TEXT,
  delivery_thread_id TEXT,
  delivery_account_id TEXT,
  delivery_best_effort INTEGER,
  delivery_completion_mode TEXT,
  delivery_completion_to TEXT,
  failure_delivery_mode TEXT,
  failure_delivery_channel TEXT,
  failure_delivery_to TEXT,
  failure_delivery_account_id TEXT,
  failure_alert_disabled INTEGER,
  failure_alert_after INTEGER,
  failure_alert_channel TEXT,
  failure_alert_to TEXT,
  failure_alert_cooldown_ms INTEGER,
  failure_alert_include_skipped INTEGER,
  failure_alert_mode TEXT,
  failure_alert_account_id TEXT,
  next_run_at_ms INTEGER,
  running_at_ms INTEGER,
  last_run_at_ms INTEGER,
  last_run_status TEXT,
  last_error TEXT,
  last_duration_ms INTEGER,
  consecutive_errors INTEGER,
  consecutive_skipped INTEGER,
  schedule_error_count INTEGER,
  last_delivery_status TEXT,
  last_delivery_error TEXT,
  last_delivered INTEGER,
  last_failure_alert_at_ms INTEGER,
  job_json TEXT NOT NULL,
  state_json TEXT NOT NULL DEFAULT '{}',
  runtime_updated_at_ms INTEGER,
  schedule_identity TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (store_key, job_id)
);

CREATE INDEX IF NOT EXISTS idx_cron_jobs_store_updated
  ON cron_jobs(store_key, sort_order ASC, updated_at DESC, job_id);

CREATE INDEX IF NOT EXISTS idx_cron_jobs_enabled_next_run
  ON cron_jobs(store_key, enabled, next_run_at_ms, job_id)
  WHERE next_run_at_ms IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cron_jobs_agent_session
  ON cron_jobs(agent_id, session_key, updated_at DESC, job_id)
  WHERE agent_id IS NOT NULL OR session_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS command_log_entries (
  id TEXT NOT NULL PRIMARY KEY,
  timestamp_ms INTEGER NOT NULL,
  action TEXT NOT NULL,
  session_key TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  source TEXT NOT NULL,
  entry_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_command_log_entries_timestamp
  ON command_log_entries(timestamp_ms DESC, id);

CREATE INDEX IF NOT EXISTS idx_command_log_entries_session
  ON command_log_entries(session_key, timestamp_ms DESC, id);

CREATE TABLE IF NOT EXISTS delivery_queue_entries (
  queue_name TEXT NOT NULL,
  id TEXT NOT NULL,
  status TEXT NOT NULL,
  entry_kind TEXT,
  session_key TEXT,
  channel TEXT,
  target TEXT,
  account_id TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_at INTEGER,
  last_error TEXT,
  recovery_state TEXT,
  platform_send_started_at INTEGER,
  entry_json TEXT NOT NULL,
  enqueued_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  failed_at INTEGER,
  PRIMARY KEY (queue_name, id)
);

CREATE INDEX IF NOT EXISTS idx_delivery_queue_pending
  ON delivery_queue_entries(queue_name, status, enqueued_at, id);

CREATE INDEX IF NOT EXISTS idx_delivery_queue_failed
  ON delivery_queue_entries(queue_name, status, failed_at, id);

CREATE INDEX IF NOT EXISTS idx_delivery_queue_session
  ON delivery_queue_entries(queue_name, status, session_key, enqueued_at, id)
  WHERE session_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_delivery_queue_target
  ON delivery_queue_entries(queue_name, status, channel, target, enqueued_at, id)
  WHERE channel IS NOT NULL AND target IS NOT NULL;

CREATE TABLE IF NOT EXISTS task_runs (
  task_id TEXT NOT NULL PRIMARY KEY,
  runtime TEXT NOT NULL,
  task_kind TEXT,
  source_id TEXT,
  requester_session_key TEXT,
  owner_key TEXT NOT NULL,
  scope_kind TEXT NOT NULL,
  child_session_key TEXT,
  parent_flow_id TEXT,
  parent_task_id TEXT,
  agent_id TEXT,
  run_id TEXT,
  label TEXT,
  task TEXT NOT NULL,
  status TEXT NOT NULL,
  delivery_status TEXT NOT NULL,
  notify_policy TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  ended_at INTEGER,
  last_event_at INTEGER,
  cleanup_after INTEGER,
  error TEXT,
  progress_summary TEXT,
  terminal_summary TEXT,
  terminal_outcome TEXT
);

CREATE INDEX IF NOT EXISTS idx_task_runs_run_id ON task_runs(run_id);
CREATE INDEX IF NOT EXISTS idx_task_runs_status ON task_runs(status);
CREATE INDEX IF NOT EXISTS idx_task_runs_runtime_status ON task_runs(runtime, status);
CREATE INDEX IF NOT EXISTS idx_task_runs_cleanup_after ON task_runs(cleanup_after);
CREATE INDEX IF NOT EXISTS idx_task_runs_last_event_at ON task_runs(last_event_at);
CREATE INDEX IF NOT EXISTS idx_task_runs_owner_key ON task_runs(owner_key);
CREATE INDEX IF NOT EXISTS idx_task_runs_parent_flow_id ON task_runs(parent_flow_id);
CREATE INDEX IF NOT EXISTS idx_task_runs_child_session_key ON task_runs(child_session_key);

CREATE TABLE IF NOT EXISTS long_task_checkpoints (
  id TEXT NOT NULL PRIMARY KEY,
  idempotency_key TEXT UNIQUE,
  session_key TEXT NOT NULL,
  agent_id TEXT, 
  workspace_id TEXT, 
  task_ledger_root_id TEXT,
  run_id TEXT, 
  trace_id TEXT,
  clawgraph_run_id TEXT,
  trigger TEXT NOT NULL,
  status TEXT NOT NULL,
  checkpoint_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_long_task_checkpoints_session
  ON long_task_checkpoints(session_key, created_at DESC, id);

CREATE INDEX IF NOT EXISTS idx_long_task_checkpoints_status 
  ON long_task_checkpoints(status, created_at DESC, id); 

CREATE INDEX IF NOT EXISTS idx_long_task_checkpoints_ledger_root
  ON long_task_checkpoints(task_ledger_root_id, created_at DESC, id);

CREATE TABLE IF NOT EXISTS long_task_intervention_events (
  id TEXT NOT NULL PRIMARY KEY,
  idempotency_key TEXT UNIQUE,
  session_key TEXT NOT NULL,
  agent_id TEXT, 
  workspace_id TEXT, 
  task_ledger_root_id TEXT,
  run_id TEXT, 
  trace_id TEXT,
  clawgraph_run_id TEXT,
  checkpoint_id TEXT,
  mode TEXT,
  trigger TEXT NOT NULL,
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_long_task_intervention_session
  ON long_task_intervention_events(session_key, created_at DESC, id);

CREATE INDEX IF NOT EXISTS idx_long_task_intervention_status 
  ON long_task_intervention_events(status, created_at DESC, id); 

CREATE INDEX IF NOT EXISTS idx_long_task_intervention_ledger_root
  ON long_task_intervention_events(task_ledger_root_id, created_at DESC, id);

CREATE TABLE IF NOT EXISTS long_task_user_queue (
  id TEXT NOT NULL PRIMARY KEY,
  idempotency_key TEXT UNIQUE,
  session_key TEXT NOT NULL,
  agent_id TEXT, 
  workspace_id TEXT, 
  task_ledger_root_id TEXT,
  status TEXT NOT NULL, 
  text TEXT NOT NULL,
  source TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at INTEGER,
  last_error TEXT,
  drained_at INTEGER,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_long_task_user_queue_session
  ON long_task_user_queue(session_key, status, created_at, id);

CREATE INDEX IF NOT EXISTS idx_long_task_user_queue_pending 
  ON long_task_user_queue(status, created_at, id); 

CREATE INDEX IF NOT EXISTS idx_long_task_user_queue_ledger_root
  ON long_task_user_queue(task_ledger_root_id, status, created_at, id);

CREATE TABLE IF NOT EXISTS runtime_task_event_log_records (
  event_id TEXT NOT NULL PRIMARY KEY,
  task_id TEXT NOT NULL,
  task_sequence INTEGER NOT NULL,
  kind TEXT NOT NULL,
  event_timestamp INTEGER NOT NULL,
  appended_at INTEGER NOT NULL,
  idempotency_key TEXT,
  session_key TEXT,
  workspace_id TEXT,
  run_id TEXT,
  task_ledger_root_id TEXT,
  trace_id TEXT,
  schema_version INTEGER NOT NULL,
  schema_marker TEXT NOT NULL,
  record_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_runtime_task_event_log_task_sequence
  ON runtime_task_event_log_records(task_id, task_sequence);

CREATE INDEX IF NOT EXISTS idx_runtime_task_event_log_session
  ON runtime_task_event_log_records(session_key, appended_at DESC, task_id);

CREATE INDEX IF NOT EXISTS idx_runtime_task_event_log_trace
  ON runtime_task_event_log_records(trace_id, appended_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_runtime_task_event_log_task_idempotency
  ON runtime_task_event_log_records(task_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS sekb_trajectories (
  trajectory_id TEXT NOT NULL PRIMARY KEY,
  created_at TEXT NOT NULL,
  task_intent TEXT NOT NULL,
  task_type TEXT NOT NULL,
  context_fingerprint_json TEXT NOT NULL,
  steps_json TEXT NOT NULL,
  outcome TEXT NOT NULL,
  error_signature TEXT,
  cost_json TEXT NOT NULL,
  distilled INTEGER NOT NULL DEFAULT 0,
  distilled_into_json TEXT NOT NULL DEFAULT '[]',
  expires_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  updated_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sekb_trajectories_task
  ON sekb_trajectories(task_type, outcome, distilled, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sekb_trajectories_error
  ON sekb_trajectories(error_signature, created_at DESC)
  WHERE error_signature IS NOT NULL;

CREATE TABLE IF NOT EXISTS sekb_principles (
  principle_id TEXT NOT NULL PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  title TEXT NOT NULL,
  condition TEXT NOT NULL,
  action TEXT NOT NULL,
  reason TEXT NOT NULL,
  full_content TEXT NOT NULL,
  task_types_json TEXT NOT NULL,
  context_tags_json TEXT NOT NULL,
  embedding_json TEXT,
  source_trajectories_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  status TEXT NOT NULL,
  retrieval_count INTEGER NOT NULL DEFAULT 0,
  adoption_count INTEGER NOT NULL DEFAULT 0,
  post_adoption_success INTEGER NOT NULL DEFAULT 0,
  criticality TEXT NOT NULL DEFAULT 'medium',
  pinned INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_sekb_principles_status
  ON sekb_principles(status, updated_at DESC, principle_id);

CREATE TABLE IF NOT EXISTS sekb_error_signature_cache (
  raw_error_hash TEXT NOT NULL PRIMARY KEY,
  raw_error_sample TEXT NOT NULL,
  error_signature TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sekb_distillation_rejections (
  rejection_id TEXT NOT NULL PRIMARY KEY,
  created_at TEXT NOT NULL,
  suggestion_json TEXT NOT NULL,
  reason TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sekb_batch_distillation_events (
  batch_id TEXT NOT NULL PRIMARY KEY,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL,
  fallback_reason TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  suggestion_count INTEGER NOT NULL DEFAULT 0,
  duplicate_suggestion_count INTEGER NOT NULL DEFAULT 0,
  attributed_suggestion_count INTEGER NOT NULL DEFAULT 0,
  attribution_total REAL NOT NULL DEFAULT 0,
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_cost_usd REAL,
  trace_id TEXT NOT NULL,
  confirmation_count INTEGER NOT NULL DEFAULT 0,
  rejection_count INTEGER NOT NULL DEFAULT 0,
  edit_distance_sum REAL NOT NULL DEFAULT 0,
  edit_distance_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS mission_runs (
  mission_id TEXT NOT NULL PRIMARY KEY,
  session_key TEXT NOT NULL,
  agent_id TEXT,
  workspace_id TEXT,
  objective TEXT NOT NULL,
  acceptance_json TEXT NOT NULL,
  status TEXT NOT NULL,
  phase TEXT NOT NULL,
  tick_count INTEGER NOT NULL DEFAULT 0,
  repair_tick_count INTEGER NOT NULL DEFAULT 0,
  max_ticks INTEGER NOT NULL,
  max_repair_ticks INTEGER NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  last_decision TEXT,
  last_reason TEXT,
  last_reviewer_summary TEXT,
  next_wake_at INTEGER,
  blocked_reason TEXT,
  trace_id TEXT,
  task_loop_run_id TEXT,
  evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  risks_json TEXT NOT NULL DEFAULT '[]',
  remaining_json TEXT NOT NULL DEFAULT '[]',
  no_progress_hash TEXT,
  schedule_json TEXT NOT NULL DEFAULT '{}',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 0,
  active_tick_id TEXT,
  last_wake_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_mission_runs_session
  ON mission_runs(session_key, updated_at DESC, mission_id);

CREATE INDEX IF NOT EXISTS idx_mission_runs_status
  ON mission_runs(status, updated_at DESC, mission_id);

CREATE TABLE IF NOT EXISTS mission_events (
  id TEXT NOT NULL PRIMARY KEY,
  mission_id TEXT NOT NULL,
  session_key TEXT NOT NULL,
  type TEXT NOT NULL,
  phase TEXT NOT NULL,
  status TEXT NOT NULL,
  tick INTEGER NOT NULL DEFAULT 0,
  decision TEXT,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mission_events_mission
  ON mission_events(mission_id, created_at, id);

CREATE INDEX IF NOT EXISTS idx_mission_events_session
  ON mission_events(session_key, created_at DESC, id);

CREATE TABLE IF NOT EXISTS subagent_runs (
  run_id TEXT NOT NULL PRIMARY KEY,
  child_session_key TEXT NOT NULL,
  controller_session_key TEXT,
  requester_session_key TEXT NOT NULL,
  requester_display_key TEXT NOT NULL,
  requester_origin_json TEXT,
  task TEXT NOT NULL,
  task_name TEXT,
  cleanup TEXT NOT NULL,
  label TEXT,
  model TEXT,
  agent_dir TEXT,
  workspace_dir TEXT,
  run_timeout_seconds INTEGER,
  spawn_mode TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  session_started_at INTEGER,
  accumulated_runtime_ms INTEGER,
  ended_at INTEGER,
  outcome_json TEXT,
  archive_at_ms INTEGER,
  cleanup_completed_at INTEGER,
  cleanup_handled INTEGER,
  suppress_announce_reason TEXT,
  expects_completion_message INTEGER,
  announce_retry_count INTEGER,
  last_announce_retry_at INTEGER,
  last_announce_delivery_error TEXT,
  ended_reason TEXT,
  pause_reason TEXT,
  wake_on_descendant_settle INTEGER,
  frozen_result_text TEXT,
  frozen_result_captured_at INTEGER,
  fallback_frozen_result_text TEXT,
  fallback_frozen_result_captured_at INTEGER,
  ended_hook_emitted_at INTEGER,
  pending_final_delivery INTEGER,
  pending_final_delivery_created_at INTEGER,
  pending_final_delivery_last_attempt_at INTEGER,
  pending_final_delivery_attempt_count INTEGER,
  pending_final_delivery_last_error TEXT,
  pending_final_delivery_payload_json TEXT,
  completion_announced_at INTEGER,
  payload_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_subagent_runs_child_session_key
  ON subagent_runs(child_session_key, created_at DESC, run_id);
CREATE INDEX IF NOT EXISTS idx_subagent_runs_requester_session_key
  ON subagent_runs(requester_session_key, created_at DESC, run_id);
CREATE INDEX IF NOT EXISTS idx_subagent_runs_controller_session_key
  ON subagent_runs(controller_session_key, created_at DESC, run_id);
CREATE INDEX IF NOT EXISTS idx_subagent_runs_archive_at
  ON subagent_runs(archive_at_ms, cleanup_handled, run_id);
CREATE INDEX IF NOT EXISTS idx_subagent_runs_ended_cleanup
  ON subagent_runs(ended_at, cleanup_handled, run_id);

CREATE TABLE IF NOT EXISTS current_conversation_bindings (
  binding_key TEXT NOT NULL PRIMARY KEY,
  binding_id TEXT NOT NULL,
  target_agent_id TEXT NOT NULL,
  target_session_id TEXT,
  target_session_key TEXT NOT NULL,
  channel TEXT NOT NULL,
  account_id TEXT NOT NULL,
  conversation_kind TEXT NOT NULL,
  parent_conversation_id TEXT,
  conversation_id TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  status TEXT NOT NULL,
  bound_at INTEGER NOT NULL,
  expires_at INTEGER,
  metadata_json TEXT,
  record_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_current_conversation_bindings_target
  ON current_conversation_bindings(target_agent_id, target_session_key, updated_at DESC, binding_key);
CREATE INDEX IF NOT EXISTS idx_current_conversation_bindings_conversation
  ON current_conversation_bindings(channel, account_id, conversation_kind, conversation_id);
CREATE INDEX IF NOT EXISTS idx_current_conversation_bindings_expires
  ON current_conversation_bindings(expires_at, binding_key);

CREATE TABLE IF NOT EXISTS plugin_binding_approvals (
  plugin_root TEXT NOT NULL,
  channel TEXT NOT NULL,
  account_id TEXT NOT NULL,
  plugin_id TEXT NOT NULL,
  plugin_name TEXT,
  approved_at INTEGER NOT NULL,
  PRIMARY KEY (plugin_root, channel, account_id)
);

CREATE INDEX IF NOT EXISTS idx_plugin_binding_approvals_plugin
  ON plugin_binding_approvals(plugin_id, approved_at DESC);

CREATE TABLE IF NOT EXISTS tui_last_sessions (
  scope_key TEXT NOT NULL PRIMARY KEY,
  session_key TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tui_last_sessions_session_key
  ON tui_last_sessions(session_key, updated_at DESC, scope_key);

CREATE TABLE IF NOT EXISTS task_delivery_state (
  task_id TEXT NOT NULL PRIMARY KEY,
  requester_origin_json TEXT,
  last_notified_event_at INTEGER,
  FOREIGN KEY (task_id) REFERENCES task_runs(task_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS flow_runs (
  flow_id TEXT NOT NULL PRIMARY KEY,
  shape TEXT,
  sync_mode TEXT NOT NULL DEFAULT 'managed',
  owner_key TEXT NOT NULL,
  requester_origin_json TEXT,
  controller_id TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  notify_policy TEXT NOT NULL,
  goal TEXT NOT NULL,
  current_step TEXT,
  blocked_task_id TEXT,
  blocked_summary TEXT,
  state_json TEXT,
  wait_json TEXT,
  -- RC-06A: delivery projection persisted on the same row as the lifecycle
  -- transition so delivery/lifecycle can never split; owned by flow_runs.
  delivery_state TEXT,
  cancel_requested_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  ended_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_flow_runs_status ON flow_runs(status);
CREATE INDEX IF NOT EXISTS idx_flow_runs_owner_key ON flow_runs(owner_key);
CREATE INDEX IF NOT EXISTS idx_flow_runs_updated_at ON flow_runs(updated_at);

-- KS-03 unified knowledge governance metadata. Candidate rows store inbox/draft
-- bodies and metadata only; Wiki/Memory/Principle canonical payloads remain in
-- their domain owners. Legacy JSON under <config>/knowledge is read-only after
-- one-shot import.
CREATE TABLE IF NOT EXISTS knowledge_candidates (
  id TEXT NOT NULL PRIMARY KEY,
  record_kind TEXT NOT NULL,
  kind TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  source_ids_json TEXT NOT NULL,
  source_refs_json TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  workspace_id TEXT,
  agent_id TEXT,
  role_tags_json TEXT,
  created_by TEXT NOT NULL,
  warnings_json TEXT,
  metadata_json TEXT,
  capture_key TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  content_digest TEXT NOT NULL,
  steward_notes TEXT,
  confidence REAL,
  promoted_draft_id TEXT,
  promoted_proposal_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  reviewed_at TEXT,
  applied_at TEXT,
  promoted_at TEXT,
  dismissed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_knowledge_candidates_capture
  ON knowledge_candidates(capture_key) WHERE capture_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_knowledge_candidates_status
  ON knowledge_candidates(status, record_kind, updated_at);

CREATE TABLE IF NOT EXISTS knowledge_governance_proposals (
  id TEXT NOT NULL PRIMARY KEY,
  operation TEXT NOT NULL,
  status TEXT NOT NULL,
  target_page_ids_json TEXT,
  draft_id TEXT,
  diff TEXT,
  reason TEXT NOT NULL,
  sources_json TEXT NOT NULL,
  requires_user_confirmation INTEGER NOT NULL DEFAULT 1,
  workspace_id TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  content_digest TEXT,
  reviewed_digest TEXT,
  expected_revision INTEGER,
  idempotency_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  applied_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_proposals_idempotency
  ON knowledge_governance_proposals(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_knowledge_proposals_draft
  ON knowledge_governance_proposals(draft_id, status);

CREATE TABLE IF NOT EXISTS knowledge_governance_events (
  id TEXT NOT NULL PRIMARY KEY,
  stream TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_knowledge_governance_events_stream
  ON knowledge_governance_events(stream, created_at);

CREATE TABLE IF NOT EXISTS knowledge_owner_links (
  source_ref TEXT NOT NULL PRIMARY KEY,
  owner TEXT NOT NULL,
  subject_kind TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  content_digest TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_knowledge_owner_links_subject
  ON knowledge_owner_links(owner, subject_kind, subject_id);

CREATE INDEX IF NOT EXISTS idx_flow_runs_blocked_task
  ON flow_runs(blocked_task_id, status, updated_at)
  WHERE blocked_task_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_flow_runs_controller_status
  ON flow_runs(controller_id, status, updated_at);

CREATE TABLE IF NOT EXISTS context_blocks (
  block_id TEXT NOT NULL PRIMARY KEY,
  block_type TEXT NOT NULL,
  source_system TEXT NOT NULL,
  session_id TEXT,
  summary TEXT NOT NULL,
  full_content TEXT,
  presence_json TEXT NOT NULL,
  mutability TEXT NOT NULL,
  role_scope TEXT,
  entities_json TEXT,
  entity_extraction_status TEXT DEFAULT 'pending',
  compression_depth INTEGER NOT NULL DEFAULT 0,
  fallback_mode TEXT,
  retention_confidence REAL,
  valid_at INTEGER NOT NULL,
  invalid_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS block_entity_map (
  block_id TEXT NOT NULL REFERENCES context_blocks(block_id),
  entity TEXT NOT NULL COLLATE NOCASE,
  PRIMARY KEY (block_id, entity)
);

CREATE INDEX IF NOT EXISTS idx_entity ON block_entity_map(entity);
CREATE INDEX IF NOT EXISTS idx_block_type_valid
  ON context_blocks(block_type, valid_at, invalid_at);
CREATE INDEX IF NOT EXISTS idx_session ON context_blocks(session_id, block_type);
CREATE INDEX IF NOT EXISTS idx_source ON context_blocks(source_system);
CREATE INDEX IF NOT EXISTS idx_block_type_source
  ON context_blocks(block_type, source_system);
CREATE INDEX IF NOT EXISTS idx_invalid
  ON context_blocks(invalid_at) WHERE invalid_at IS NULL;

CREATE TABLE IF NOT EXISTS migration_runs (
  id TEXT NOT NULL PRIMARY KEY,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  status TEXT NOT NULL,
  report_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_migration_runs_started
  ON migration_runs(started_at DESC, id);

CREATE TABLE IF NOT EXISTS migration_sources (
  source_key TEXT NOT NULL PRIMARY KEY,
  migration_kind TEXT NOT NULL,
  source_path TEXT NOT NULL,
  target_table TEXT NOT NULL,
  source_sha256 TEXT,
  source_size_bytes INTEGER,
  source_record_count INTEGER,
  last_run_id TEXT NOT NULL,
  status TEXT NOT NULL,
  imported_at INTEGER NOT NULL,
  removed_source INTEGER NOT NULL DEFAULT 0,
  report_json TEXT NOT NULL,
  FOREIGN KEY (last_run_id) REFERENCES migration_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_migration_sources_path
  ON migration_sources(source_path, migration_kind, target_table);

CREATE INDEX IF NOT EXISTS idx_migration_sources_run
  ON migration_sources(last_run_id, source_path);

CREATE TABLE IF NOT EXISTS backup_runs (
  id TEXT NOT NULL PRIMARY KEY,
  created_at INTEGER NOT NULL,
  archive_path TEXT NOT NULL,
  status TEXT NOT NULL,
  manifest_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_backup_runs_created
  ON backup_runs(created_at DESC, id);

-- RC-02 receipt persistence owner (user-confirmed 2026-08-02): typed, append-only
-- runtime_receipts table in the existing openclaw-state SQLite, exposed through a
-- narrow ReceiptStore interface. Seven hard constraints:
--  1. digest/refs/call-index/version/policy-digest only; never raw prompt/tool output/credentials.
--  2. append-only; same idempotency_key with identical content is idempotent success,
--     different content must conflict-fail.
--  3. no max(sequence)+1; explicit attempt/model-call/wire-attempt identity via
--     attempt_index/model_call_index/wire_attempt_index columns.
--  4. no silent pruning; deletion requires an explicit lifecycle policy.
--  5. shadow write failure must not change send behavior but must fail RC-02 acceptance.
--  6. receipt explains and correlates facts only; never authorizes replay; domain journals
--     remain the effect/idempotency truth.
--  7. npm fallback reports degraded and never counts toward receipt coverage.
CREATE TABLE IF NOT EXISTS runtime_receipts (
  receipt_id TEXT NOT NULL PRIMARY KEY CHECK (
    length(receipt_id) BETWEEN 6 AND 64 AND receipt_id GLOB 'rcpt_*'
  ),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 512),
  kind TEXT NOT NULL CHECK (kind IN ('shadow_context','shadow_wire','context','wire','effect')),
  runtime_mode TEXT NOT NULL CHECK (runtime_mode IN ('source','npm')),
  version TEXT NOT NULL CHECK (
    (kind IN ('shadow_context','shadow_wire') AND version = '0') OR
    (kind IN ('context','wire','effect') AND version = '1')
  ),
  session_key TEXT CHECK (session_key IS NULL OR length(session_key) BETWEEN 1 AND 256),
  run_id TEXT CHECK (run_id IS NULL OR length(run_id) BETWEEN 1 AND 256),
  trace_id TEXT CHECK (trace_id IS NULL OR length(trace_id) BETWEEN 1 AND 256),
  attempt_index INTEGER NOT NULL CHECK (attempt_index BETWEEN 0 AND 2147483647),
  model_call_index INTEGER NOT NULL CHECK (model_call_index BETWEEN 0 AND 2147483647),
  wire_attempt_index INTEGER NOT NULL CHECK (wire_attempt_index BETWEEN 0 AND 2147483647),
  provider_id TEXT CHECK (provider_id IS NULL OR length(provider_id) BETWEEN 1 AND 256),
  adapter_id TEXT CHECK (adapter_id IS NULL OR length(adapter_id) BETWEEN 1 AND 256),
  transform_ids_json TEXT CHECK (
    transform_ids_json IS NULL OR
    (length(transform_ids_json) <= 8192 AND json_valid(transform_ids_json) AND json_type(transform_ids_json) = 'array')
  ),
  selected_json TEXT CHECK (
    selected_json IS NULL OR
    (length(selected_json) <= 16384 AND json_valid(selected_json) AND json_type(selected_json) = 'array')
  ),
  omitted_json TEXT CHECK (
    omitted_json IS NULL OR
    (length(omitted_json) <= 16384 AND json_valid(omitted_json) AND json_type(omitted_json) = 'array')
  ),
  candidate_decisions_json TEXT CHECK (
    candidate_decisions_json IS NULL OR
    (length(candidate_decisions_json) <= 32768 AND json_valid(candidate_decisions_json) AND json_type(candidate_decisions_json) = 'object')
  ),
  budget_json TEXT CHECK (
    budget_json IS NULL OR
    (length(budget_json) <= 256 AND json_valid(budget_json) AND json_type(budget_json) = 'object')
  ),
  policy_digest TEXT CHECK (
    policy_digest IS NULL OR
    (length(policy_digest) = 64 AND policy_digest NOT GLOB '*[^0-9a-f]*')
  ),
  logical_digest TEXT CHECK (
    logical_digest IS NULL OR
    (length(logical_digest) = 64 AND logical_digest NOT GLOB '*[^0-9a-f]*')
  ),
  wire_digest TEXT CHECK (
    wire_digest IS NULL OR
    (length(wire_digest) = 64 AND wire_digest NOT GLOB '*[^0-9a-f]*')
  ),
  correlation_digest TEXT NOT NULL CHECK (
    length(correlation_digest) = 64 AND correlation_digest NOT GLOB '*[^0-9a-f]*'
  ),
  content_digest TEXT NOT NULL CHECK (
    length(content_digest) = 64 AND content_digest NOT GLOB '*[^0-9a-f]*'
  ),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  CHECK (kind NOT IN ('shadow_context','context') OR logical_digest IS NOT NULL),
  CHECK (kind NOT IN ('shadow_wire','wire') OR wire_digest IS NOT NULL),
  CHECK (kind = 'effect' OR (provider_id IS NOT NULL AND adapter_id IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_runtime_receipts_idempotency
  ON runtime_receipts(idempotency_key);

CREATE INDEX IF NOT EXISTS idx_runtime_receipts_kind_created
  ON runtime_receipts(kind, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_runtime_receipts_run_attempt
  ON runtime_receipts(run_id, attempt_index, model_call_index, wire_attempt_index);

CREATE INDEX IF NOT EXISTS idx_runtime_receipts_session
  ON runtime_receipts(session_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_runtime_receipts_correlation
  ON runtime_receipts(correlation_digest);

-- RC-04 durable approval owner: replaces the Gateway process Map pending/resolved
-- truth with a durable ledger in the existing openclaw-state SQLite. State
-- sequence: intent_reserved -> approval_pending -> approved|denied ->
-- execution_started -> applied|not_applied|unknown -> reconciled. Repeated
-- identical resolve is idempotent; denial produces no effect; an unknown outcome
-- stops in needs_reconciliation and is never auto-replayed.
CREATE TABLE IF NOT EXISTS approval_ledger (
  approval_id TEXT NOT NULL PRIMARY KEY,
  idempotency_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN (
    'intent_reserved','approval_pending','approved','denied',
    'execution_started','applied','not_applied','unknown','reconciled',
    'needs_reconciliation'
  )),
  -- RC-04: only the canonical SHA-256 digest of the request is stored. Raw
  -- request payloads (which may carry command text or secrets) never persist;
  -- legacy request_json columns are migrated to request_digest on reopen.
  request_digest TEXT NOT NULL,
  -- Optimistic-concurrency revision: every transition bumps revision and the
  -- UPDATE is guarded by WHERE revision = ? so stale writers are rejected.
  revision INTEGER NOT NULL DEFAULT 1,
  requested_by_conn_id TEXT,
  requested_by_device_id TEXT,
  requested_by_client_id TEXT,
  expires_at_ms INTEGER NOT NULL,
  resolved_at_ms INTEGER,
  decision TEXT,
  resolved_by TEXT,
  effect_receipt_id TEXT,
  domain_journal_ref TEXT,
  -- RC-04: outcome records the applied|not_applied|unknown intermediate state
  -- observed between execution_started and reconciled (persisted so the full
  -- state sequence is auditable even after the row reaches reconciled).
  outcome TEXT CHECK (outcome IN ('applied','not_applied','unknown')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_approval_ledger_idempotency
  ON approval_ledger(idempotency_key);

CREATE INDEX IF NOT EXISTS idx_approval_ledger_state_created
  ON approval_ledger(state, created_at DESC);

-- RC-04 EffectReceipt: explains and correlates domain-journal outcomes; it never
-- authorizes replay. Domain journals remain the effect/idempotency truth.
CREATE TABLE IF NOT EXISTS effect_receipts (
  effect_receipt_id TEXT NOT NULL PRIMARY KEY,
  idempotency_key TEXT NOT NULL,
  approval_id TEXT,
  -- RC-04: only the canonical SHA-256 digest of the proposal is stored; raw
  -- proposal payloads never persist. Legacy proposal_json columns are migrated
  -- to proposal_digest on reopen.
  proposal_digest TEXT NOT NULL,
  approval_decision TEXT,
  domain_executor TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('applied','not_applied','unknown','reconciled')),
  artifact_ref TEXT,
  journal_ref TEXT,
  recoverability TEXT NOT NULL,
  -- Stage 1 logical EffectReceipt/v1 correlation. Digest/ref/identifier facts
  -- only; raw proposal, tool arguments, and tool output never enter this JSON.
  effect_context_json TEXT NOT NULL DEFAULT '{}' CHECK (
    json_valid(effect_context_json) AND json_type(effect_context_json) = 'object'
  ),
  -- Idempotency comparison includes the schema version so a format change
  -- conflicts instead of silently matching an old receipt.
  schema_version TEXT NOT NULL DEFAULT '2',
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_effect_receipts_idempotency
  ON effect_receipts(idempotency_key);

CREATE INDEX IF NOT EXISTS idx_effect_receipts_approval
  ON effect_receipts(approval_id, created_at DESC);

-- TF-0718/TF-0719: durable execution phase.
-- One row per tool invocation, keyed by a stable idempotency key. The committed
-- phase is the only judge of "what already happened"; the domain journal stays
-- the effect truth. No raw tool arguments/output are stored here.
CREATE TABLE IF NOT EXISTS execution_phases (
  execution_id TEXT NOT NULL PRIMARY KEY,
  idempotency_key TEXT NOT NULL,
  session_key TEXT,
  run_id TEXT,
  task_id TEXT,
  tool_name TEXT NOT NULL,
  effect_class TEXT NOT NULL CHECK (effect_class IN ('safe','unsafe','reconcile')),
  phase TEXT NOT NULL CHECK (phase IN (
    'admitted','dispatched','effect_pending','effect_committed','verified','terminal','failed','aborted'
  )),
  revision INTEGER NOT NULL DEFAULT 0,
  intent_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(intent_json) AND json_type(intent_json) = 'object'),
  recovery_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(recovery_json) AND json_type(recovery_json) = 'object'),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_execution_phases_idempotency
  ON execution_phases(idempotency_key);

CREATE INDEX IF NOT EXISTS idx_execution_phases_session
  ON execution_phases(session_key, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_execution_phases_phase
  ON execution_phases(phase, updated_at DESC);\n`;

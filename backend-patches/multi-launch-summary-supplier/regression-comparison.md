# Legacy regression comparison — 2026-10-09

## Completed isolated comparison

The same 23 existing multiple-launch and summary-card tests were run separately
against the exact original VM baseline and the candidate. Both completed:
19 passed; 2 failures and 2 errors. The four case identities and failure causes
are identical. There are no additional failures in this completed scoped group.

| Case | Baseline | Candidate | Existing failure |
| --- | --- | --- | --- |
| test_multiple_launch_confirmation_can_delete_a_line_and_recalculate_summary | ERROR | ERROR | KeyError: actions |
| test_multiple_launch_supplier_edit_keeps_filial_and_stage | ERROR | ERROR | RuntimeError: etag conflict |
| test_multiple_launch_inherits_first_line_and_attaches_only_to_last | FAIL | FAIL | Old expected navigation menu differs from current menu |
| test_multiple_launch_summary_edit_changes_only_selected_line | FAIL | FAIL | Old expectation excludes an existing navigation-back action |

Commands: set SUMMARY_SUPPLIER_SOURCE to the baseline or candidate and run
`python -B run_regressions.py`. Fresh Linux runs took 6.686s and 6.110s,
respectively. These legacy tests are not declared green and their unrelated
navigation/persistence behavior was not changed by this summary-only patch.

## Interrupted full discovery — not a green suite

Both fresh `python -B -m unittest discover -s tests -v` processes exhibited
substantial failures and excessive state-copy memory growth. Only the two
verified, task-owned test processes were interrupted with SIGINT.
Their tracebacks end in recursive copy.deepcopy and KeyboardInterrupt.
No production service was stopped by that test cleanup.

The original run lasted about 10 minutes; the candidate about 6 minutes.
The different stopping points make pass/failure counts incomparable. No full
suite completion or full-suite absence of regressions is claimed.

The original log contains 189 exact FAIL/ERROR result lines
(146 distinct identities); the candidate contains 119
(119 distinct identities). Every failing identity observed in the
candidate partial log also appears in the baseline partial log. This is
limited partial-run evidence, not a full-suite conclusion.

The following list records every distinct observed failed/error case by name.
A dash means not reached/observed before interruption, not a passing result.
Duplicated cases discovered through imported fixtures are collapsed.

| Exact partial-log identity and outcome | Original partial run | Candidate partial run |
| --- | --- | --- |
| `test_abandoning_resumed_construction_diary_removes_main_menu_option (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_any_new_text_opens_selectable_action_menu (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_attachment_after_fifteen_minutes_restarts_and_is_retained (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_attachment_after_lazy_inactivity_only_offers_current_or_new_flow (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_attachment_after_thirty_minutes_asks_current_or_new_flow (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_attachment_after_thirty_minutes_can_start_new_flow (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_attachment_in_expired_flow_can_start_new_flow_and_is_preserved (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_attachment_in_expired_flow_offers_two_destinations_and_can_resume (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_attendance_batch_conflict_offers_exit_without_trapping_menu (test_workflow.WorkflowTests) ... ERROR` | Observed | Observed |
| `test_attendance_batch_missing_id_can_exit_instead_of_retrying_forever (test_workflow.WorkflowTests) ... ERROR` | Observed | Observed |
| `test_attendance_can_close_demonstrative_and_resume_same_question (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_attendance_can_fill_blank_field_before_summary (test_workflow.WorkflowTests) ... ERROR` | Observed | Observed |
| `test_attendance_completion_lists_remaining_ids_desc_and_continues (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_attendance_contract_edit_reasks_filtered_partial_measurement (test_workflow.WorkflowTests) ... ERROR` | Observed | Observed |
| `test_attendance_daily_supplier_warns_when_daily_value_is_blank (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_attendance_deletion_removes_only_selected_sharepoint_item (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_attendance_deletion_requires_named_confirmation_and_no_returns_to_review (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_attendance_edit_back_returns_to_review_before_presence_question (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_attendance_measurement_supplier_allows_blank_daily_value (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_attendance_partial_measurement_edit_does_not_offer_supplier_sync (test_workflow.WorkflowTests) ... ERROR` | Observed | Observed |
| `test_attendance_payment_fields_can_remain_blank_without_warning (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_attendance_payment_id_edit_submits_multiple_ids_comma_separated (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_attendance_pending_menu_report_asks_date_and_returns_to_pending_list (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_attendance_stage_edit_reasks_only_filtered_activity (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_attendance_syncs_contract_to_supplier_without_partial_measurement_column (test_workflow.WorkflowTests) ... ERROR` | Observed | Observed |
| `test_attendance_warns_about_other_blank_fields_but_not_payment_fields (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_audit_registration_submenu_has_emojis_and_back_navigation (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_back_reopens_previous_question_repeatedly_until_main_menu (test_workflow.WorkflowTests) ... ERROR` | Observed | Observed |
| `test_cancel_confirmation_main_menu_saves_pending_submission_as_draft (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_channel_bridge (unittest.loader._FailedTest) ... ERROR` | Observed | Observed |
| `test_commercial_receipt_create_offers_optional_attachments_before_summary (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_commercial_receipt_create_sources_match_form33_and_real_schema (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_completed_construction_diary_fields_offer_information_or_attachment (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_completed_diary_continuation_can_return_to_main_menu (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_completed_diary_photo_append_can_leave_pending_photos_untitled (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_completed_today_diary_can_receive_photos_and_replaces_only_old_photo_pdf (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_confirmation_retry_does_not_duplicate_sharepoint_item (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_construction_diary_additional_text_is_appended_without_overwrite (test_workflow.WorkflowTests) ... ERROR` | Observed | Observed |
| `test_construction_diary_can_apply_one_title_only_to_current_pending_photos (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_construction_diary_commit_retargets_unique_pending_replacement (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_construction_diary_create_accepts_photos_without_title (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_construction_diary_create_accumulates_unique_stages_for_selected_branch (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_construction_diary_create_matches_form4_1_fields_and_defaults (test_workflow.WorkflowTests) ... ERROR` | Observed | Observed |
| `test_construction_diary_create_reuses_titled_photo_and_pdf_pipeline (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_construction_diary_exit_without_partial_post_keeps_sharepoint_unchanged (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_construction_diary_fill_accepts_pending_photos_without_title (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_construction_diary_fill_updates_only_changed_fields (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_construction_diary_groups_photos_by_title_and_keeps_pdf_separate (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_construction_diary_recovers_legacy_individual_compression_with_original (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_construction_diary_requests_one_title_for_each_pending_photo (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_construction_diary_stages_rank_by_recent_presence_same_branch (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_construction_diary_stays_latent_while_other_flows_are_used (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_construction_stage_can_be_closed_from_stage_menu_with_latest_activity (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_construction_stage_can_close_demonstrative_as_standalone_action (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_continue_diary_replaces_start_diary_on_main_menu (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_delegated_responsible_text_filters_or_adopts_explicit_value (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_delegated_task_date_presets_and_typed_date (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_diary_attachment_at_confirmation_preserves_existing_photo_pdf (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_dynamic_selection_is_always_ordered_by_numeric_id (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_editing_supplier_reasks_only_supplier_filial_and_etapa (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_embedded_registration_token_remains_unique_after_processed_id_cap (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_fim_cancels_and_resets_form_for_a_new_attachment (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_fim_cancels_from_confirmation_without_writing_sharepoint (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_first_message_after_timeout_does_not_discard_paused_form (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_global_measurement_line_skips_dimensions_and_uses_quantity (test_workflow.WorkflowTests) ... ERROR` | Observed | Observed |
| `test_hr_profession_registration_matches_powerapps_form (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_hr_profession_registration_rejects_duplicate (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_hr_supplier_registration_reuses_complete_form2_flow (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_human_resources_attendance_data_menu_has_day_and_period_reports (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_human_resources_can_link_selected_attendance_to_payment (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_human_resources_can_register_contract_line_like_form38 (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_human_resources_can_register_contractor_contract_like_form1_6 (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_human_resources_contract_menu_registers_unit_measurement_line_like_form25 (test_workflow.WorkflowTests) ... ERROR` | Observed | Observed |
| `test_inactivity_main_menu_saves_paused_form_and_attachments (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_inactivity_over_one_hour_offers_resume_or_main_menu (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_inactivity_resume_returns_to_exact_selection_with_previous_answers (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_inconsistency_type_registration_uppercases_and_rejects_duplicate (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_issue_date_offers_today_as_selectable_action (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_large_attachment_requests_compression_immediately_and_resumes_collection (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_large_diary_pdf_is_preserved_without_individual_compression (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_latent_construction_diary_expires_after_twenty_hours (test_workflow.WorkflowTests) ... ERROR` | Observed | Observed |
| `test_launch_branch_inserts_unlisted_default_from_selected_supplier (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_launch_can_register_supplier_and_continue_with_it (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_launch_offers_link_to_supplier_pending_attendance_and_marks_paid (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_launch_pending_attendance_link_can_be_declined_without_updates (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_launch_product_list_reserves_last_visible_option_for_registration (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_log_uses_all_configured_databases_and_shows_item_detail (test_audit_log.AuditLogTests) ... FAIL` | Observed | Observed |
| `test_logic (unittest.loader._FailedTest) ... ERROR` | Observed | — |
| `test_main_menu_control_saves_current_form_and_returns_to_groups (test_workflow.WorkflowTests) ... ERROR` | Observed | Observed |
| `test_main_menu_during_attachment_compression_saves_pending_file_in_draft (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_measurement_line_form25_defaults_and_multiple_lines (test_workflow.WorkflowTests) ... ERROR` | Observed | Observed |
| `test_message_after_expiration_keeps_form_paused_until_button_choice (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_missing_staged_payment_attachment_preserves_form_and_requests_reupload (test_workflow.WorkflowTests) ... ERROR` | Observed | Observed |
| `test_multiple_launch_confirmation_can_delete_a_line_and_recalculate_summary (test_workflow.WorkflowTests) ... ERROR` | Observed | Observed |
| `test_multiple_launch_inherits_first_line_and_attaches_only_to_last (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_multiple_launch_summary_edit_changes_only_selected_line (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_multiple_launch_supplier_edit_keeps_filial_and_stage (test_workflow.WorkflowTests) ... ERROR` | Observed | Observed |
| `test_navigation_back_from_first_embedded_question_restores_parent (test_workflow.WorkflowTests) ... ERROR` | Observed | Observed |
| `test_new_document_starts_with_fields_and_collects_required_attachments_last (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_new_order_launch_creates_verified_pending_order_then_launch (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_next_aliases_page_through_default_descending_id_order (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_no_match_keeps_filtered_catalogue_visible_for_retry (test_filtered_options_unlimited.FilteredOptionsUnlimitedTests) ... FAIL` | Observed | Observed |
| `test_obtain_documents_asks_for_another_after_count (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_old_filtered_page_restarts_at_first_match (test_filtered_options_unlimited.FilteredOptionsUnlimitedTests) ... FAIL` | Observed | Observed |
| `test_opa_restarts_current_flow_and_returns_initial_options (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_open_fields_put_the_typing_instruction_in_the_question (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_partial_construction_diary_posts_received_photos_and_keeps_them_for_resume (test_workflow.WorkflowTests) ... ERROR` | Observed | Observed |
| `test_partial_new_construction_diary_is_created_pending_and_resumes_same_id (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_payment_can_register_material_supplier_and_continue_with_it (test_workflow.WorkflowTests) ... ERROR` | Observed | Observed |
| `test_payment_can_register_product_and_continue_with_quantity (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_payment_edit_menu_prioritizes_unit_value (test_workflow.WorkflowTests) ... ERROR` | Observed | Observed |
| `test_payment_flow_writes_expected_list_fields_and_summary (test_workflow.WorkflowTests) ... ERROR` | Observed | Observed |
| `test_payment_past_due_date_requires_explicit_confirmation_or_edit (test_workflow.WorkflowTests) ... ERROR` | Observed | Observed |
| `test_payment_provision_edit_shows_attachments_and_filters_imovel (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_payment_provision_edit_updates_due_date_without_settling (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_payment_rejects_invalid_numbers_and_accepts_optional_attachment (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_payment_settlement_creates_pending_order_launch_and_updates_provision (test_workflow.WorkflowTests) ... ERROR` | Observed | Observed |
| `test_payment_settlement_existing_launch_requires_password_and_relinks (test_workflow.WorkflowTests) ... FAIL` | Observed | Observed |
| `test_payment_supplier_registration_asks_full_labor_fields (test_workflow.WorkflowTests) ... ERROR` | Observed | — |
| `test_pending_construction_diary_merges_new_image_into_existing_pdf (test_workflow.WorkflowTests) ... FAIL` | Observed | — |
| `test_pending_document_submission_replaces_pdf_and_marks_submitted (test_generated_document_sign_later.GeneratedDocumentSignLaterTest) ... ERROR` | Observed | Observed |
| `test_pending_order_registration_validates_and_writes_requested_fields (test_workflow.WorkflowTests) ... FAIL` | Observed | — |
| `test_personal_expense_launch_writes_automatic_and_selected_fields (test_workflow.WorkflowTests) ... FAIL` | Observed | — |
| `test_recurring_task_calculates_creation_dates_and_status (test_workflow.WorkflowTests) ... FAIL` | Observed | — |
| `test_rent_homologation_edit_is_granular_and_accepts_new_types (test_workflow.WorkflowTests) ... ERROR` | Observed | — |
| `test_restart_command_also_requires_partial_diary_save_decision (test_workflow.WorkflowTests) ... FAIL` | Observed | — |
| `test_single_launch_conversion_preserves_first_line_and_attachment (test_workflow.WorkflowTests) ... FAIL` | Observed | — |
| `test_single_launch_summary_offers_add_more_lines (test_workflow.WorkflowTests) ... ERROR` | Observed | — |
| `test_single_launch_updates_exact_supplier_default_branch_and_resumes (test_workflow.WorkflowTests) ... FAIL` | Observed | — |
| `test_single_launch_warns_about_supplier_pending_provisions (test_workflow.WorkflowTests) ... FAIL` | Observed | — |
| `test_single_supplier_filter_can_be_cleared_back_to_selectable_options (test_workflow.WorkflowTests) ... FAIL` | Observed | — |
| `test_stale_stage_selection_uses_last_attendance_and_updates_only_safe_fields (test_workflow.WorkflowTests) ... FAIL` | Observed | — |
| `test_starred_default_is_first_then_blank_and_numeric_ids (test_workflow.WorkflowTests) ... FAIL` | Observed | — |
| `test_submission_error_menu_is_opened_only_after_user_choice (test_workflow.WorkflowTests) ... FAIL` | Observed | — |
| `test_summary_attachment_removal_requires_confirmation_and_supports_back (test_workflow.WorkflowTests) ... FAIL` | Observed | — |
| `test_summary_edit_can_add_an_attachment_from_the_attachment_menu (test_workflow.WorkflowTests) ... FAIL` | Observed | — |
| `test_supplier_blank_button_label_is_not_saved_as_field_value (test_workflow.WorkflowTests) ... ERROR` | Observed | — |
| `test_supplier_form2_worker_dependencies_are_asked_and_saved (test_workflow.WorkflowTests) ... FAIL` | Observed | — |
| `test_supplier_optional_text_questions_offer_blank_buttons (test_workflow.WorkflowTests) ... FAIL` | Observed | — |
| `test_supply_product_registration_writes_selected_and_fixed_fields (test_workflow.WorkflowTests) ... FAIL` | Observed | — |
| `test_supply_supplier_registration_matches_all_form2_fields_and_writes_fields (test_workflow.WorkflowTests) ... FAIL` | Observed | — |
| `test_task_summary_can_edit_description_before_commit (test_workflow.WorkflowTests) ... FAIL` | Observed | — |
| `test_terminal_actions_are_preserved_in_addition_to_all_matches (test_filtered_options_unlimited.FilteredOptionsUnlimitedTests) ... FAIL` | Observed | Observed |
| `test_text_filter_returns_selectable_options_with_blank (test_workflow.WorkflowTests) ... FAIL` | Observed | — |
| `test_total_attachment_limit_requests_consent_and_compresses_before_summary (test_workflow.WorkflowTests) ... FAIL` | Observed | — |
| `test_unstarted_diary_uses_start_label_and_opens_fill_flow_from_main_menu (test_workflow.WorkflowTests) ... FAIL` | Observed | — |

Unfiltered logs are retained in the local task staging directory as
baseline-full.log, candidate-full.log, baseline-scoped.log and
candidate-scoped.log. They are diagnostic test-fixture output, not real
financial transactions. No claim is made that these old failures are fixed.

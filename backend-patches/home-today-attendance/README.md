# Presenças de hoje no menu inicial

O menu consulta as mesmas presenças pendentes da validação, filtra a data local
de São Paulo e conta IDs únicos. Exibe `PRESENÇAS (N)` somente com N > 0.
O cliente ordena o botão vermelho imediatamente antes de DIÁRIO. No clique,
o servidor recalcula a data e as pendências e abre `attendance_validation`
na etapa `registro_presenca_pendente`, sem submeter presenças. Se o menu ficou
antigo e não existem mais pendências, retorna o menu atualizado.

O seletor iniciado por esse atalho reforça os filtros de data e PRESENCA=PENDENTE
no resultado da consulta. Os caminhos legados não são modificados. Voltar/sair
preservam a política existente de saída de rascunho. Retornar ao menu recalcula N.

## Testes e implantação

- TDD: 4 testes de backend falharam na versão original por falta do atalho;
  9 testes de workflow agora passam, sem rede e sem gravações reais.
- 3 testes de interface, 1 de integração do controller e layout em Chrome
  320/390/1280 px passam. O teste estreito detectou quebra de linha e guiou
  a compactação, mantendo alvo de toque de pelo menos 44 px.
- O teste de recuperação do deploy falhou antes da correção e passou depois:
  conflito no mirror não impede tentativa de restaurar produção e reiniciar.
- Comparação de 131 testes legados: tanto baseline quanto candidato têm
  75 aprovados, 43 falhas, 12 erros e 1 ignorado; nenhuma nova regressão.
  A lista abaixo registra todos os casos antigos não aprovados, sem alegar
  que essa suíte legada está verde.
- `patch_workflow.py` exige âncoras únicas. `deploy.py` fixa hashes do workflow
  e dos instaladores já testados; usa ambos os locks compartilhados, backups
  recuperáveis por arquivo, preserva configuração e verifica saúde após restart.
  Apenas `worker/workflow.py` é instalado em produção e no espelho.
- Baseline SHA-256: `70558a64d50da382e28825486716f952c7c0c2f7725596c4e9552bd3d6dda135`.
- Candidato SHA-256: `910a6d02e87c35c83af13914fc43e34e014caa24ad5c3fffe455547b42c55c85`.

Implantado em 13/10/2026 às 20:51 UTC: ambos os destinos com esse hash,
saúde HTTP `status=ok`. A consulta real bloqueando escritas remotas confirmou
`PRESENÇAS (10)` para 13/10/2026. Configuração carregada do mesmo arquivo do
serviço (`/etc/energetica-whatsapp.env`); nenhum segredo é exibido.
Suíte completa local do aplicativo: 5.922 aprovados, zero falhas/ignorados;
testes adicionados posteriormente de controller e navegador aprovados à parte.

### Casos preexistentes não aprovados

- `test_workflow.WorkflowTests.test_abandoning_resumed_construction_diary_removes_main_menu_option`
- `test_workflow.WorkflowTests.test_attendance_absence_requires_reason_and_zeros_daily_value_only_on_confirm`
- `test_workflow.WorkflowTests.test_attendance_batch_edit_limits_fields_and_applies_activity_to_every_id`
- `test_workflow.WorkflowTests.test_attendance_batch_summary_uses_demonstrative_activity`
- `test_workflow.WorkflowTests.test_attendance_can_close_demonstrative_and_resume_same_question`
- `test_workflow.WorkflowTests.test_attendance_can_sync_changed_activity_to_selected_supplier_on_final_confirmation`
- `test_workflow.WorkflowTests.test_attendance_completion_lists_remaining_ids_desc_and_continues`
- `test_workflow.WorkflowTests.test_attendance_completion_merges_concurrent_processed_activity`
- `test_workflow.WorkflowTests.test_attendance_completion_recovers_from_concurrent_alert_state_save`
- `test_workflow.WorkflowTests.test_attendance_daily_supplier_warns_when_daily_value_is_blank`
- `test_workflow.WorkflowTests.test_attendance_deletion_removes_only_selected_sharepoint_item`
- `test_workflow.WorkflowTests.test_attendance_deletion_requires_named_confirmation_and_no_returns_to_review`
- `test_workflow.WorkflowTests.test_attendance_edit_back_returns_to_review_before_presence_question`
- `test_workflow.WorkflowTests.test_attendance_ignores_legacy_description_mismatch`
- `test_workflow.WorkflowTests.test_attendance_inconsistent_stage_is_blocked_before_sharepoint_write`
- `test_workflow.WorkflowTests.test_attendance_legacy_description_mismatch_does_not_block_commit`
- `test_workflow.WorkflowTests.test_attendance_measurement_supplier_allows_blank_daily_value`
- `test_workflow.WorkflowTests.test_attendance_payment_fields_can_remain_blank_without_warning`
- `test_workflow.WorkflowTests.test_attendance_payment_id_edit_submits_multiple_ids_comma_separated`
- `test_workflow.WorkflowTests.test_attendance_pending_menu_report_asks_date_and_returns_to_pending_list`
- `test_workflow.WorkflowTests.test_attendance_present_updates_only_selected_item_after_confirmation`
- `test_workflow.WorkflowTests.test_attendance_remaining_filter_stays_selectable_and_can_finish`
- `test_workflow.WorkflowTests.test_attendance_remaining_record_also_warns_for_finalized_descriptive`
- `test_workflow.WorkflowTests.test_attendance_stage_edit_reasks_only_filtered_activity`
- `test_workflow.WorkflowTests.test_attendance_warns_about_other_blank_fields_but_not_payment_fields`
- `test_workflow.WorkflowTests.test_cancel_confirmation_main_menu_saves_pending_submission_as_draft`
- `test_workflow.WorkflowTests.test_completed_diary_continuation_can_return_to_main_menu`
- `test_workflow.WorkflowTests.test_continue_diary_replaces_start_diary_on_main_menu`
- `test_workflow.WorkflowTests.test_emoji_votes_cancel_restore_and_return_to_main_menu`
- `test_workflow.WorkflowTests.test_human_resources_attendance_data_menu_has_day_and_period_reports`
- `test_workflow.WorkflowTests.test_human_resources_can_link_selected_attendance_to_payment`
- `test_workflow.WorkflowTests.test_human_resources_menu_starts_attendance_validation`
- `test_workflow.WorkflowTests.test_inactivity_main_menu_saves_paused_form_and_attachments`
- `test_workflow.WorkflowTests.test_inactivity_over_one_hour_offers_resume_or_main_menu`
- `test_workflow.WorkflowTests.test_launch_offers_link_to_supplier_pending_attendance_and_marks_paid`
- `test_workflow.WorkflowTests.test_launch_pending_attendance_link_can_be_declined_without_updates`
- `test_workflow.WorkflowTests.test_main_menu_during_attachment_compression_saves_pending_file_in_draft`
- `test_workflow.WorkflowTests.test_pending_attendance_absence_offers_common_motivations_and_accepts_text`
- `test_workflow.WorkflowTests.test_pending_attendance_absence_preset_button_is_saved_as_motivation`
- `test_workflow.WorkflowTests.test_pending_attendance_absence_prompts_for_motivation_or_not_reported`
- `test_workflow.WorkflowTests.test_pending_attendance_no_pending_activities_preset_is_saved_as_motivation`
- `test_workflow.WorkflowTests.test_stale_stage_selection_uses_last_attendance_and_updates_only_safe_fields`
- `test_workflow.WorkflowTests.test_unstarted_diary_uses_start_label_and_opens_fill_flow_from_main_menu`
- `test_workflow.WorkflowTests.test_attendance_batch_absent_asks_reason_then_confirms_all_ids`
- `test_workflow.WorkflowTests.test_attendance_batch_conflict_offers_exit_without_trapping_menu`
- `test_workflow.WorkflowTests.test_attendance_batch_missing_id_can_exit_instead_of_retrying_forever`
- `test_workflow.WorkflowTests.test_attendance_batch_present_requires_confirmation_and_updates_every_selected_id`
- `test_workflow.WorkflowTests.test_attendance_batch_resumes_action_after_reconnect`
- `test_workflow.WorkflowTests.test_attendance_batch_warns_about_finalized_descriptive`
- `test_workflow.WorkflowTests.test_attendance_can_fill_blank_field_before_summary`
- `test_workflow.WorkflowTests.test_attendance_contract_edit_reasks_filtered_partial_measurement`
- `test_workflow.WorkflowTests.test_attendance_partial_measurement_edit_does_not_offer_supplier_sync`
- `test_workflow.WorkflowTests.test_attendance_syncs_contract_to_supplier_without_partial_measurement_column`
- `test_workflow.WorkflowTests.test_back_reopens_previous_question_repeatedly_until_main_menu`
- `test_workflow.WorkflowTests.test_main_menu_control_saves_current_form_and_returns_to_groups`

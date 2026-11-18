def _start_group_menu_options(self, state: dict) -> list[dict]:
    if self._nb_portal_session(state):
        return [item for item in self._start_groups()
                if item.get("id") in {"group_nb_participacoes", "group_personal_expenses"}]
    from concurrent.futures import ThreadPoolExecutor
    import copy

    def read(method, *args):
        client = getattr(self, "sharepoint", None)
        if not hasattr(client, "session"):
            return getattr(self, method)(*args)
        # requests.Session and mutable field/token caches must not be shared
        # across workers. Deep-copy the configured session, including retries.
        reader = copy.copy(self)
        reader.sharepoint = copy.copy(client)
        reader.sharepoint._field_cache = copy.deepcopy(client._field_cache)
        reader.sharepoint._field_type_cache = copy.deepcopy(client._field_type_cache)
        with copy.deepcopy(client.session) as session:
            reader.sharepoint.session = session
            return getattr(reader, method)(*args)

    # Diary recovery can reconcile durable state. Run it once on this thread;
    # only independent SharePoint reads enter the bounded pool.
    try:
        _, startable, latent_action = self._pending_construction_diary_options(state)
    except Exception:
        startable, latent_action = [], None
    with ThreadPoolExecutor(max_workers=3, thread_name_prefix="home-menu") as pool:
        attendance = pool.submit(read, "_pending_attendance_days_count")
        pathology = pool.submit(read, "_pending_pathologies_count")
        notes = pool.submit(read, "_pending_notes_count")
        documents = pool.submit(read, "_pending_documents_count", state)
        provisions = pool.submit(read, "_pending_provisions")
        today_attendance = pool.submit(read, "_today_pending_attendance_action", state)
        # Reuse only within this menu; later requests read fresh source data.
        provision_rows = provisions.result()
        pending_count = (len(startable) + bool(latent_action) + len(provision_rows)
                         + attendance.result() + pathology.result()
                         + notes.result() + documents.result())
        today_attendance = today_attendance.result()
    today = datetime.now(ZoneInfo("America/Sao_Paulo")).date()
    pending_provisions_due = any(
        due is not None and due <= today
        for due in (self._pending_provision_due_date(row) for row in provision_rows)
    )
    groups = [
        ({
            **item,
            "title": f"⏳ PENDÊNCIAS ({pending_count})",
            **({"tone": "danger"} if pending_provisions_due else {}),
        }
         if item.get("id") == PENDING_GROUP_ID else item)
        for item in self._start_groups()
    ]
    diary_actions = [latent_action] if latent_action else []
    diary_start = self._startable_construction_diary_action(startable)
    if diary_start:
        diary_actions.append(diary_start)
    shortcuts = ([today_attendance] if today_attendance else []) + diary_actions
    return groups[:1] + shortcuts + groups[1:]


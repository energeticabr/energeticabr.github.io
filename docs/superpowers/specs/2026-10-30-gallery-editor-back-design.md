# Gallery editor back button

Add a visible left arrow at the top left of every gallery edit screen. Its accessible name is `Voltar à galeria sem salvar`. Clicking cancels the draft through the existing editor close path and reveals the originating gallery without fetching, saving, navigating to the main menu, resetting filters, or moving the gallery scroll position. Keep the existing cancel action and prevent leaving during an in-flight write.

Use a shared header style and the existing editor lifecycle. Apply it to the generic gallery editor, including loading/error/form-variant states, and to independent gallery editors found in the coverage audit. Preserve nested dialogs and the protected signature blocks. Validate with fictitious data at narrow and desktop sizes and publish web, Android internal, and iOS TestFlight.

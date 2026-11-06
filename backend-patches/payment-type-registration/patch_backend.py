"""Reproducible patch against the verified active backend snapshot."""
from pathlib import Path
import sys

def once(text, before, after):
 if text.count(before)!=1: raise RuntimeError('Source anchor drift: '+before[:100])
 return text.replace(before,after,1)

def patch(relative,data):
 text=data.decode('utf-8')
 if relative=='worker/financial_catalog_registration.py':
  text+='\n\n'+Path(__file__).with_name('payroll_catalog.py').read_text(encoding='utf-8-sig')
 elif relative=='worker/workflow.py':
  text=once(text,'        # Anexos recebidos depois da janela de silêncio nunca decidem sozinhos\n', '''        # Inline catalog cancellation/back must preserve the pending financial step.
        if (state and state.get("stage") == LAUNCH_PAYROLL_TYPE_STAGE
                and financial_catalog.payroll_draft(state) is not None
                and event.get("kind") == "text"
                and not self._is_navigation_main_menu(event.get("reply_id") or event.get("text"))
                and command != DRAFT_SAVE_ID):
            return financial_catalog.payroll_handle_draft(self, event, state, etag, LAUNCH_PAYROLL_TYPE_OPTIONS)

        # Anexos recebidos depois da janela de silêncio nunca decidem sozinhos
''')
  anchor='''    def _prompt_launch_payroll_type(
        self, state: dict, etag: str | None
    ) -> dict:
'''
  text=once(text,anchor,anchor+'''        if financial_catalog.payroll_draft(state) is not None:
            return financial_catalog.payroll_prompt_draft(self, state, etag)
''')
  start=text.index('            [\n                {"id": (f"launch_payroll_type_for_')
  end=text.index('            allow_back=False,',start)
  text=text[:start]+'            financial_catalog.payroll_actions(self, state, LAUNCH_PAYROLL_TYPE_OPTIONS),\n'+text[end:]
  text=once(text,'''        selected_type = next(
            (
                title
                for option_id, title in LAUNCH_PAYROLL_TYPE_OPTIONS
''','''        control = financial_catalog.payroll_control(self, state, etag, raw, message_id)
        if control is not None:
            return control
        try:
            catalog_options = financial_catalog.payroll_choices(self, LAUNCH_PAYROLL_TYPE_OPTIONS)
        except Exception:
            self._send_text(state, "❌ NÃO FOI POSSÍVEL VALIDAR O TIPO NO SHAREPOINT. TENTE NOVAMENTE.")
            return self._prompt_launch_payroll_type(state, etag)
        selected_type = next(
            (
                title
                for option_id, title in catalog_options
''')
 else: raise RuntimeError('Unexpected file: '+relative)
 compile(text,relative,'exec')
 return text.encode()

if __name__=='__main__':
 root=Path(sys.argv[1])
 for relative in ('worker/workflow.py','worker/financial_catalog_registration.py'):
  p=root/relative;p.write_bytes(patch(relative,p.read_bytes()))

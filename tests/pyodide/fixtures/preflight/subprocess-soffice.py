import subprocess
subprocess.run(["soffice", "--headless", "--convert-to", "pdf", "doc.docx"])

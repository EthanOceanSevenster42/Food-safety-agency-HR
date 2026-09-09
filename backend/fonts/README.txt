This folder is scanned by the SOW PDF generator for branded fonts that aren't
pre-installed on Windows (Poppins, Montserrat, Inter, Roboto, Lato, …).

To enable Poppins (or any other Google Font) in the company branding:

  1. Download the font's TTF files from https://fonts.google.com
     (click the family, then "Get font" → "Download all").
  2. Unzip and copy these four files into THIS folder:

       Poppins-Regular.ttf
       Poppins-Bold.ttf
       Poppins-Italic.ttf
       Poppins-BoldItalic.ttf

     (Filenames must match exactly — they're case-sensitive on some setups.)

  3. Restart the backend so the font registry re-scans this folder.
  4. In the company branding modal, type or pick "Poppins" in the
     "Font family" field. Generated PDFs will use it.

Supported families and the filenames the loader expects:

  Poppins      Poppins-Regular.ttf,    Poppins-Bold.ttf,    Poppins-Italic.ttf,    Poppins-BoldItalic.ttf
  Montserrat   Montserrat-Regular.ttf, Montserrat-Bold.ttf, Montserrat-Italic.ttf, Montserrat-BoldItalic.ttf
  Inter        Inter-Regular.ttf,      Inter-Bold.ttf,      Inter-Italic.ttf,      Inter-BoldItalic.ttf
  Roboto       Roboto-Regular.ttf,     Roboto-Bold.ttf,     Roboto-Italic.ttf,     Roboto-BoldItalic.ttf
  Lato         Lato-Regular.ttf,       Lato-Bold.ttf,       Lato-Italic.ttf,       Lato-BoldItalic.ttf
  Open Sans    OpenSans-Regular.ttf,   OpenSans-Bold.ttf,   OpenSans-Italic.ttf,   OpenSans-BoldItalic.ttf

If only some variants are present the loader falls back to Helvetica for the
whole document (rather than mixing a real Bold with a fake Italic).

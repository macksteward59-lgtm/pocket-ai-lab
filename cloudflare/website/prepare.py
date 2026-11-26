"""Build the public presentation of the checked-out Pocket AI Lab web shell."""
from html.parser import HTMLParser
from pathlib import Path
import shutil
import sys

# The original consumer API uses local files and accepts loopback peers only.
# Only these browser assets and the read-only shell are published.
PROFILE = Path(__file__).resolve().parent
ASSETS = ('styles.css', 'manifest.webmanifest', 'icon.svg')
EMPTY = {'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}

class PublicShell(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.stack, self.out, self.views = [], [], set()

    def handle_decl(self, value):
        self.out.append('<!'+value+'>')

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        ident = attrs.get('id','')
        classes = set(attrs.get('class','').split())
        hidden = bool(self.stack and self.stack[-1][1])
        before = ''
        if not hidden:
            if tag == 'section' and ident.endswith('-view'):
                self.views.add(ident)
            if tag == 'form' or tag == 'script' or ident in {'new-chat','memory-list','memory-refresh'} or classes & {'suggestions','memory-list-heading','memory-warning','profile','privacy-card','agent-runner'}:
                hidden = True
            if ident == 'connection':
                before = '<span class="connection">Web preview</span>'
                hidden = True
            if ident == 'welcome':
                before = '<p role="note">Web preview. Chat, private memory and agent execution require the local Pocket AI Lab app.</p>'
            if ident == 'memory-form':
                before = '<p>Saved notes are accessible in the local app.</p>'
            if ident == 'new-chat':
                before = '<a class="new-chat" href="https://github.com/macksteward59-lgtm/pocket-ai-lab#run-locally">Open local setup</a>'
        if before:
            self.out.append(before)
        if not hidden:
            self.out.append(self.get_starttag_text())
        if tag not in EMPTY:
            self.stack.append((tag,hidden))

    def handle_endtag(self, tag):
        if not self.stack or tag != self.stack[-1][0]:
            raise ValueError('Unexpected end tag: '+tag)
        _, hidden = self.stack.pop()
        if not hidden:
            if tag == 'body':
                self.out.append('<script src="/hosted.js" defer></script>')
            self.out.append('</'+tag+'>')

    def handle_data(self, value):
        if not self.stack or not self.stack[-1][1]:
            self.out.append(value)
    def handle_charref(self, name):
        self.handle_data('&#'+name+';')
    def handle_entityref(self, name):
        self.handle_data('&'+name+';')

def build(source):
    dest = PROFILE / 'public'
    dest.mkdir(exist_ok=True)
    expected = set(ASSETS) | {'_headers','hosted.js','index.html'}
    if any(p.name not in expected or p.is_symlink() for p in dest.iterdir()):
        raise ValueError('Unexpected entry in the website output directory')
    doc = PublicShell()
    doc.feed((source/'index.html').read_text())
    doc.close()
    if doc.stack or doc.views != {n+'-view' for n in ['chat','agents','settings','memory','activity']}:
        raise ValueError('Web shell layout changed; review the public rendering')
    (dest/'index.html').write_text(''.join(doc.out))
    for name in ASSETS:
        shutil.copyfile(source/name, dest/name)
    for name in ('hosted.js','_headers'):
        shutil.copyfile(PROFILE/name, dest/name)

if __name__ == '__main__':
    build(Path(sys.argv[1]) if len(sys.argv)>1 else PROFILE.parents[1]/'apps/web')

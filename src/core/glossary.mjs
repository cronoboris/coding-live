import { caster, looksFailed, shellSteps, commandWords } from './caster.mjs';
export { shellSteps } from './caster.mjs';
import { detectTricks } from './lessons.mjs';
import { t, language } from '../i18n/index.mjs';

const english = {
  kinds: {
    read: ['Read file', 'Reads a file. Like opening a book to see what it says.'],
    write: ['Write file', 'Creates a file with new contents. Like writing in a blank notebook.'],
    edit: ['Edit file', 'Changes part of a file. Like find-and-replace in a document.'],
    search: ['Search', 'Finds matching names or text. Like using a book index.'],
    plan: ['Plan', 'Lists the work in order. Like making a shopping list.'],
    delegate: ['Subagent', 'Gives part of the work to another AI. Like dividing chores among helpers.'],
    other: ['Tool', 'Runs a program or feature. Like taking a utensil from a kitchen drawer.'],
  },
  git: {
    status: 'Lists changes waiting to be saved. Like a summary of unsaved work.',
    diff: 'Compares changed lines with their earlier version. Like tracked changes in a document.',
    log: 'Lists saved work, newest first. Like browsing game saves.',
    add: 'Selects changes for the next saved step. Like packing selected items into a box.',
    commit: "Saves everything you've changed as one step in the project's history. Like a save point in a game.",
    push: 'Uploads local work history to a remote repository. Like backing up a notebook to the cloud.',
    pull: 'Downloads remote changes and combines them with local work. Like merging edits to a shared document.',
    checkout: 'Switches branches or saved versions, or restores files. Like choosing another draft from a folder.',
    switch: 'Changes the working branch. Like moving to another room in the same house.',
    branch: 'Creates, lists, or deletes branches for separate work. Like keeping separate drafts of a letter.',
    clone: 'Copies an entire repository to this computer. Like photocopying a whole project binder.',
    reset: 'Moves saved history or selected changes back to an earlier state. Like returning to an earlier game save.',
    stash: 'Temporarily puts unfinished changes aside. Like keeping papers in a drawer for later.',
    restore: 'Returns file contents to a saved state. Like restoring a sentence you erased.',
    clean: 'Deletes files outside saved history. Like discarding loose papers: check the list first because deletion cannot be undone.',
  },
  packages: {
    install: 'Downloads and installs the parts the project needs. Like getting screws for flat-pack furniture.',
    add: 'Adds and installs a new outside component. Like putting another item in a shopping basket.',
    test: 'Runs the project tests and checks their results. Like grading a stack of exam papers.',
    run: 'Runs a command saved in the project. Like pressing a programmed remote-control button.',
    build: 'Makes a usable version of the project. Like cooking ingredients into a finished meal.',
  },
  commands: {
    electron: 'Runs a desktop app built with web technology. Like opening a website in its own app window.',
    dotnet: 'Builds, runs, or checks .NET programs. Like a workshop for .NET projects.',
    sort: 'Puts lines in order. Like alphabetizing index cards.',
    cut: 'Selects fields from each line. Like taking one column from a table.',
    diff: 'Compares two files. Like placing two drafts side by side.',
    awk: 'Processes text by fields. Like calculating or replacing cells in a table.',
    du: 'Measures the space files occupy. Like weighing packed boxes.',
    df: 'Shows free disk space. Like checking empty shelf space.',
    ps: 'Lists running programs. Like checking who is currently at work.',
    kill: 'Sends a signal to a program, often to stop it. Like asking a machine to shut down.',
    xxd: 'Shows file bytes as numbers. Like examining the numbered beads in a necklace.',
    objdump: 'Examines the structure of a compiled file. Like looking inside a machine.',
    strings: 'Finds readable text inside a file. Like picking out labels among packed parts.',
    java: 'Runs Java programs. Like following a recipe written in Java.',
    sleep: 'Waits for a specified time. Like setting a kitchen timer.',
    tar: 'Bundles or unpacks files. Like packing or opening a box.',
    unzip: 'Unpacks compressed files. Like opening a vacuum-packed bag.',
    zip: 'Compresses files into an archive. Like squeezing clothes into a travel bag.',
    jq: 'Selects or changes parts of JSON data. Like finding entries in a structured form.',
    which: 'Finds a program on the command search path. Like looking up a shop address.',
    export: 'Sets values for programs launched later. Like handing the next worker an instruction card.',
    source: 'Runs a file of commands in the current shell. Like following instructions at your current desk.',
    pwd: 'Shows the current folder path. Like a you-are-here marker on a map.',
    date: 'Shows the date and time. Like checking a clock and calendar.',
    env: 'Shows environment values or runs a program with them. Like reading or changing a machine settings card.',
    xargs: 'Passes input items to a command as arguments. Like feeding a list of addresses to a label printer.',
    tee: 'Sends output to both the screen and a file. Like making a copy while reading a letter aloud.',
    uniq: 'Removes or counts neighboring duplicate lines. Like stacking identical adjacent cards together.',
    tr: 'Replaces or deletes characters. Like swapping letter tiles.',
    file: 'Identifies a file type. Like checking the label on a box.',
    stat: 'Shows file details such as size and modification time. Like reading a parcel label.',
    ln: 'Creates a link to a file. Like adding another sign pointing to the same room.',
    basename: 'Extracts the file name from a path. Like taking just the house number from an address.',
    dirname: 'Extracts the folder part of a path. Like taking the street from an address.',
    realpath: 'Resolves the full file path. Like turning directions into an exact address.',
    ssh: 'Connects securely to another computer. Like using a locked private doorway.',
    scp: 'Copies files between computers securely. Like sending a sealed parcel.',
    rsync: 'Synchronizes files by comparing changes. Like updating a spare binder with only the changed pages.',
    docker: 'Manages isolated environments called containers. Like keeping each project in its own workroom.',
    kubectl: 'Manages applications running in Kubernetes containers. Like checking many separate workrooms from one desk.',
    gh: 'Manages GitHub repositories and requests. Like a remote control for the project noticeboard.',
    uv: 'Manages Python environments and packages. Like organizing a Python toolbox.',
    poetry: 'Manages a Python project environment and packages. Like keeping its tools and parts in one labeled kit.',
    bun: 'Runs JavaScript and manages packages. Like a combined player and toolbox.',
    deno: 'Runs JavaScript and TypeScript. Like a player that reads either of two recipe formats.',
    yarn: 'Manages packages and saved project commands. Like a parts cabinet with instruction cards.',
    pnpm: 'Manages packages and saved project commands. Like a shared parts cabinet with instruction cards.',
    npx: 'Runs a tool from the project or the internet. Like borrowing one tool from a toolbox.',
    node: 'Runs JavaScript programs. Like a player that brings a JavaScript script to life.',
    python: 'Runs Python programs. Like cooking from a recipe written in Python.',
    python3: 'Runs Python 3 programs. Like cooking from a recipe written in Python 3.',
    pip: 'Installs and manages Python packages. Like an app store for Python parts.',
    pip3: 'Installs and manages Python 3 packages. Like an app store for Python 3 parts.',
    ls: 'Lists files and folders. Like opening a drawer to see what is inside.',
    cat: 'Prints file contents. Like unfolding a whole document at once.',
    head: 'Shows the first few lines. Like peeking at the start of a book.',
    tail: 'Shows the last few lines. Like reading the latest entries in a diary.',
    grep: 'Finds lines containing matching text. Like using find in a document.',
    rg: 'Quickly searches text across files. Like looking for a word in many books at once.',
    find: 'Finds files matching conditions. Like searching the house for an item of a certain kind.',
    mkdir: 'Creates a folder. Like labeling a new binder.',
    rm: 'Deletes files without using the trash, making recovery difficult. Like tearing up paper immediately.',
    cp: 'Makes another copy of a file. Like photocopying a document.',
    mv: 'Moves or renames a file. Like moving papers to another drawer or changing their label.',
    cd: 'Changes the working folder. Like moving to another room.',
    echo: 'Prints the supplied text. Like reading a note aloud.',
    printf: 'Prints text using a specified format. Like filling in a printed form.',
    sed: 'Selects or replaces text. Like find-and-replace through written instructions.',
    curl: 'Requests data from an internet address. Like fetching information through a browser address.',
    wget: 'Downloads a file from an internet address. Like collecting a parcel from a pickup point.',
    chmod: 'Changes who can read, change, or run a file. Like deciding who gets a house key.',
    touch: 'Creates an empty file or updates its timestamp. Like setting out a blank notebook or stamping a date.',
    wc: 'Counts lines, words, or bytes. Like measuring a manuscript.',
    cargo: 'Builds, checks, and runs Rust projects. Like a dedicated Rust toolkit.',
    go: 'Builds, runs, and tests Go projects. Like a dedicated Go toolkit.',
    make: 'Runs tasks from a Makefile. Like following assembly instructions.',
    tsc: 'Checks TypeScript rules and converts it to JavaScript. Like proofreading and translating a document.',
    eslint: 'Checks code against writing rules. Like a grammar checker for code.',
    pytest: 'Runs Python tests and checks their results. Like grading a stack of exam papers.',
  },
  warnings: {
    rmRecursive: 'Warning: deleting entire folders is hard to undo. Check the targets first.',
    forcePush: "Warning: forcibly replacing remote history can erase other people's work history.",
    resetHard: 'Warning: unsaved changes will be discarded and may not be recoverable.',
    cleanForce: 'Warning: files outside saved history are deleted without confirmation.',
    chmod777: 'Warning: anyone can change this file, which is unsafe.',
  },
};

const kinds = {
  read: ['파일 읽기', '파일 내용을 확인해요. 책을 펼쳐서 어떤 내용인지 읽어 보는 것과 같아요.'],
  write: ['파일 작성', '새 파일을 만들고 내용을 처음부터 채워요. 빈 노트에 처음 글을 적는 것과 비슷해요.'],
  edit: ['파일 수정', '파일 전체가 아니라 일부만 찾아 바꿔요. 문서의 \'찾아 바꾸기\'와 비슷해요.'],
  search: ['검색', '파일 이름이나 내용에서 찾는 단어를 찾아요. 책 뒤의 색인에서 원하는 쪽을 찾는 것과 같아요.'],
  plan: ['계획', '해야 할 일을 순서대로 정리해요. 장보기 목록을 만드는 것과 비슷해요.'],
  delegate: ['서브에이전트', '큰 작업의 일부를 다른 AI 일꾼에게 맡겨요. 팀장이 일을 나눠 주는 것과 같아요.'],
  other: ['도구', 'AI가 프로그램이나 기능을 실행해요. 요리사가 주방 도구를 꺼내 쓰는 것과 비슷해요.'],
};
// Git: the project's history is a save-file system. A commit is a save point; a branch is a copy of the game to try things in.
const git = {
  status: '저장 대기 중인 변경을 파일 목록으로 보여 줘요. 게임 화면의 변경 사항 요약 같은 거예요.',
  diff: '파일이 저장되기 전과 후의 차이를 줄 단위로 비교해 보여 줘요. 문서의 \'변경 내용 보기\'와 같아요.',
  log: '지금까지 저장된 작업 기록(커밋)을 최신순으로 보여 줘요. 게임의 세이브 파일 목록을 보는 것과 같아요.',
  add: '다음 저장(커밋)에 넣을 변경을 골라 담아요. 택배 상자에 물건을 골라 담는 것과 비슷해요.',
  commit: '지금까지 바꾼 내용을 작업 기록에 한 칸 저장해요. 게임의 세이브 포인트 같은 거예요.',
  push: '내 컴퓨터에 쌓인 작업 기록을 인터넷의 원격 저장소에 올려요. 내 노트를 클라우드에 백업하는 것과 같아요.',
  pull: '원격 저장소에서 다른 사람이 올린 변경을 받아 내 작업과 합쳐요. 다른 곳에서 고친 문서를 내려받아 병합하는 것과 같아요.',
  checkout: '작업 대상을 다른 브랜치나 커밋으로 옮기거나, 파일을 마지막 저장 상태로 되돌려요.',
  switch: '작업 흐름(브랜치)을 바꿔요. 같은 프로젝트에서 다른 방으로 옮겨 가는 것과 같아요.',
  branch: '원본을 건드리지 않고 따로 실험할 작업 흐름(브랜치)을 만들거나 지워요. 게임을 복사해서 새 세이브로 시험해 보는 것과 같아요.',
  clone: '인터넷에 있는 저장소 전체를 내 컴퓨터로 통째로 복사해 와요. 다른 사람의 프로젝트를 받아 오는 것과 같아요.',
  reset: '작업 기록이나 저장 대기 목록을 예전 시점으로 되돌려요. 세이브 파일을 이전 것으로 덮어쓰는 것과 비슷해요.',
  stash: '아직 저장하지 않은 변경을 잠시 서랍에 넣어 두고, 필요할 때 다시 꺼내요.',
  restore: '파일의 내용을 마지막 저장 상태로 되돌려요. 실수로 지운 문장을 원래대로 돌리는 것과 같아요.',
  clean: '작업 기록에 올라 있지 않은 파일을 골라서 지워요. 되돌릴 수 없으니 지우기 전에 목록을 먼저 확인해야 해요.',
};
const packages = {
  install: '프로젝트가 필요로 하는 외부 부품(패키지)을 내려받아 설치해요. 조립 가구에 필요한 나사를 가져오는 것과 같아요.',
  add: '프로젝트에 새 외부 부품(패키지)을 추가하고 설치해요. 장바구니에 새 물건을 담는 것과 비슷해요.',
  test: '프로젝트에 적어 둔 테스트를 모두 돌려서 통과와 실패를 채점해요. 시험지를 한꺼번에 채점하는 것과 같아요.',
  run: '프로젝트에 미리 등록해 둔 명령(스크립트)을 실행해요. 리모컨의 저장된 버튼을 누르는 것과 같아요.',
  build: '실제로 쓸 수 있는 완성본을 만들어요. 재료를 요리해서 완성된 음식으로 만드는 것과 같아요.',
};
// Plain-language one-liners for shell commands. A warning is appended in explain() for risky flags.
const commands = {
  electron: '웹 기술로 만든 데스크톱 앱을 실행해요.',
  dotnet: '.NET 프로그램을 만들고 실행하거나 검사해요.',
  sort: '줄을 순서대로 정렬해요.', cut: '각 줄에서 필요한 칸을 골라요.', diff: '두 파일의 차이를 비교해요.',
  awk: '텍스트를 칸별로 나누어 계산하거나 바꿔요.', du: '파일이 차지하는 공간을 확인해요.', df: '저장 장치의 남은 공간을 확인해요.',
  ps: '실행 중인 프로그램을 확인해요.', kill: '프로그램에 종료 등의 신호를 보내요.',
  xxd: '파일의 바이트를 숫자로 보여 줘요.', objdump: '실행 파일의 내부 구조를 확인해요.', strings: '파일에서 읽을 수 있는 문자열을 찾아요.',
  java: '자바 프로그램을 실행해요.', sleep: '지정한 시간 동안 기다려요.', tar: '여러 파일을 묶거나 풀어요.',
  unzip: '압축 파일을 풀어요.', zip: '파일을 압축해요.', jq: 'JSON 데이터에서 필요한 부분을 골라요.',
  which: '실행할 프로그램의 위치를 찾아요.', export: '다음 프로그램에 전달할 환경 변수를 설정해요.',
  source: '현재 셸에서 파일의 명령을 읽어 실행해요.', pwd: '현재 폴더의 위치를 보여 줘요.', date: '날짜와 시각을 확인해요.',
  env: '환경 변수를 확인하거나 설정해서 실행해요.', xargs: '입력받은 목록을 명령의 인자로 전달해요.',
  tee: '출력을 화면과 파일에 함께 보내요.', uniq: '연속된 중복 줄을 정리해요.', tr: '문자를 바꾸거나 지워요.',
  file: '파일의 종류를 확인해요.', stat: '파일 크기와 수정 시각을 확인해요.', ln: '파일을 가리키는 연결을 만들어요.',
  basename: '경로에서 파일 이름을 꺼내요.', dirname: '경로에서 폴더 부분을 꺼내요.', realpath: '파일의 전체 경로를 확인해요.',
  ssh: '다른 컴퓨터에 안전하게 연결해요.', scp: '다른 컴퓨터와 파일을 복사해요.', rsync: '바뀐 파일을 비교해 동기화해요.',
  docker: '분리된 실행 환경인 컨테이너를 관리해요.', kubectl: '여러 컨테이너의 실행 상태를 관리해요.',
  gh: 'GitHub의 저장소와 요청을 관리해요.', uv: '파이썬 환경과 패키지를 관리해요.', poetry: '파이썬 프로젝트의 패키지와 환경을 관리해요.',
  bun: '자바스크립트 프로그램과 패키지를 관리해요.', deno: '자바스크립트와 타입스크립트를 실행해요.',
  yarn: '프로젝트의 패키지와 등록된 명령을 관리해요.', pnpm: '프로젝트의 패키지와 등록된 명령을 관리해요.',
  npx: '프로젝트에 설치된 도구나 인터넷의 도구를 한 번 빌려 실행해요. 공구함에서 필요한 공구만 잠깐 꺼내 쓰는 것과 같아요.',
  node: '자바스크립트 프로그램을 실행해요. 자바스크립트 코드를 읽어 움직이게 하는 재생기 같은 거예요.',
  python: '파이썬 프로그램을 실행해요. 파이썬으로 쓰인 레시피를 따라 요리하는 것과 같아요.',
  python3: '파이썬 3 프로그램을 실행해요. 파이썬으로 쓰인 레시피를 따라 요리하는 것과 같아요.',
  pip: '파이썬용 외부 부품(패키지)을 설치하고 관리해요. 파이썬의 앱스토어 같은 거예요.',
  pip3: '파이썬 3용 외부 부품(패키지)을 설치하고 관리해요. 파이썬의 앱스토어 같은 거예요.',
  ls: '폴더 안에 어떤 파일과 폴더가 있는지 목록으로 보여 줘요. 서랍을 열어 안에 뭐가 있는지 훑어보는 것과 같아요.',
  cat: '파일의 내용을 화면에 그대로 출력해요. 문서를 처음부터 끝까지 한 번에 펼쳐 보는 것과 같아요.',
  head: '파일의 처음 몇 줄만 보여 줘요. 책의 앞부분만 살짝 펼쳐 보는 것과 같아요.',
  tail: '파일의 마지막 몇 줄만 보여 줘요. 로그의 가장 최근 기록을 보는 것과 같아요.',
  grep: '파일 안에서 찾는 글자가 들어 있는 줄을 찾아 보여 줘요. 문서에서 Ctrl+F로 단어를 찾는 것과 같아요.',
  rg: '여러 파일을 빠르게 훑어서 찾는 글자가 있는 줄을 보여 줘요. 여러 권의 책에서 한꺼번에 단어를 찾는 것과 같아요.',
  find: '조건(이름, 종류 등)에 맞는 파일을 폴더 안에서 찾아요. 집 안에서 특정 물건을 찾아 헤매는 것과 같아요.',
  mkdir: '새 폴더를 만들어요. 서류철 하나를 새로 꺼내 이름을 붙이는 것과 같아요.',
  rm: '파일을 지워요. 한 번 지우면 휴지통을 거치지 않아 되돌리기 어려워요. 종이를 바로 찢어 버리는 것과 같아요.',
  cp: '파일을 복사해서 같은 내용의 파일을 하나 더 만들어요. 문서를 복사기로 한 장 더 뽑는 것과 같아요.',
  mv: '파일을 다른 곳으로 옮기거나 이름을 바꿔요. 서류를 다른 서랍으로 옮기는 것과 같아요.',
  cd: '지금 작업하는 폴더를 바꿔요. 방 안에서 다른 방으로 이동하는 것과 같아요.',
  echo: '적은 글자를 그대로 화면에 출력해요. 메모를 큰 소리로 읽어 주는 것과 같아요.',
  printf: '정해진 서식에 맞춰 글자를 출력해요. 양식지의 빈칸을 채워 찍는 것과 같아요.',
  sed: '텍스트에서 원하는 부분을 찾아 바꾸거나 골라내요. 문서의 \'찾아 바꾸기\' 기능을 명령으로 하는 것과 같아요.',
  curl: '인터넷 주소에 요청을 보내 데이터를 받아 와요. 웹 페이지 주소창에 입력해서 정보를 가져오는 것과 같아요.',
  wget: '인터넷 주소에 있는 파일을 내 컴퓨터로 내려받아요. 웹에서 파일을 다운로드하는 것과 같아요.',
  chmod: '파일을 누가 읽고, 고치고, 실행할 수 있는지 권한을 바꿔요. 집 열쇠를 누구에게 줄지 정하는 것과 같아요.',
  touch: '내용이 없는 빈 파일을 만들거나, 기존 파일의 수정 시각을 지금으로 바꿔요. 빈 노트를 한 권 꺼내 두는 것과 같아요.',
  wc: '파일의 줄 수, 단어 수, 글자 수를 세요. 원고지 분량을 세는 것과 같아요.',
  cargo: '러스트 언어로 된 프로젝트를 만들고, 검사하고, 실행해요. 러스트 프로젝트 전용 공구 세트 같은 거예요.',
  go: 'Go 언어로 된 프로젝트를 빌드하거나 실행하고 테스트해요. Go 프로젝트 전용 공구 세트 같은 거예요.',
  make: '미리 적어 둔 작업 목록(Makefile)을 순서대로 실행해요. 조립 설명서를 따라 만드는 것과 같아요.',
  tsc: '타입스크립트 코드가 규칙에 맞는지 검사하고, 일반 자바스크립트로 바꿔요. 맞춤법 검사기로 글을 확인하는 것과 같아요.',
  eslint: '코드가 정해 둔 작성 규칙을 지키는지 검사해요. 글쓰기 교정 프로그램이 문장 규칙을 점검하는 것과 같아요.',
  pytest: '파이썬으로 쓴 테스트를 모두 돌려서 통과와 실패를 채점해요. 시험지를 한꺼번에 채점하는 것과 같아요.',
};
const localizedCommands = {
  flock: 'flock', cmp: 'cmp', sh: 'shell', bash: 'shell', zsh: 'shell',
  pgrep: 'pgrep', free: 'free', '.': 'source', ffmpeg: 'ffmpeg',
  sha256sum: 'checksum', md5sum: 'checksum', systemctl: 'systemctl', '[': 'test', test: 'test', run: 'projectScript',
};

// Separators inside quotes are data, not shell steps.

// Short warnings for flags that can destroy work. They are appended after the plain explanation.
const koreanWarnings = {
  rmRecursive: '주의: 폴더째 지워서 되돌리기 어려워요. 지울 대상을 꼭 확인하세요.',
  forcePush: '주의: 원격 저장소의 기록을 강제로 덮어써서 다른 사람의 작업 기록이 사라질 수 있어요.',
  resetHard: '주의: 저장하지 않은 변경이 모두 사라져요. 되돌릴 수 없어요.',
  cleanForce: '주의: 작업 기록에 없는 파일이 확인 없이 지워져요.',
  chmod777: '주의: 누구나 이 파일을 고칠 수 있게 되어 위험해요.',
};
const withWarning = (what, warning) => (what && warning ? `${what} ${warning}` : what);
const korean = { kinds, git, packages, commands };
const isRecursiveRm = (cmd, sub, args) => cmd === 'rm' && [sub, ...args].some(a => a === '--recursive' || /^-[^-]*r/i.test(a ?? ''));

// Which warning, if any, applies to a command's flags.
function warningFor(cmd, sub, args) {
  const warnings = language() === 'en' ? english.warnings : koreanWarnings;
  if (isRecursiveRm(cmd, sub, args)) return warnings.rmRecursive;
  if (cmd === 'chmod' && [sub, ...args].some(a => /^0?777$/.test(a ?? ''))) return warnings.chmod777;
  if (cmd !== 'git') return '';
  if (sub === 'push' && args.some(a => a === '--force' || a === '-f')) return warnings.forcePush;
  if (sub === 'reset' && args.includes('--hard')) return warnings.resetHard;
  if (sub === 'clean' && args.some(a => a === '--force' || /^-[^-]*f/.test(a))) return warnings.cleanForce;
  return '';
}

export function explain(tool = {}) {
  const en = language() === 'en';
  const { kinds, git, packages, commands } = en ? english : korean;
  if (tool.kind !== 'shell') {
    const [term, what] = kinds[tool.kind] ?? kinds.other;
    return { steps: [{ term, what }], raw: String(tool.path ?? tool.pattern ?? tool.name ?? '') };
  }
  const raw = String(tool.command ?? '');
  if (/^\s*(?:for|while|until)\b/.test(raw)) return { raw, steps: [{ term: en ? 'Loop' : '반복문', what: en ? 'Repeats commands for a list or condition. Like following the same recipe for each guest.' : '조건이나 목록에 따라 반복해서 실행해요.' }] };
  if (/^\s*(?:if|case)\b/.test(raw)) return { raw, steps: [{ term: en ? 'Condition' : '조건문', what: en ? 'Chooses commands based on a condition. Like choosing clothes for the weather.' : '조건에 따라 실행할 명령을 골라요.' }] };
  return { raw, steps: shellSteps(raw).map(step => {
    const [cmd, sub, ...args] = commandWords(step);
    if (cmd && /^[\w-]+\(\)\s*\{/.test(step)) return { term: cmd, what: t('command.function') };
    if (localizedCommands[cmd]) return { term: cmd, what: t(`command.${localizedCommands[cmd]}`) };
    if (cmd === 'git' && ['show', 'worktree'].includes(sub)) return { term: `git ${sub}`, what: t(sub === 'show' ? 'command.gitShow' : 'command.gitWorktree') };
    if (cmd && /^(?:\.\/|tools\/|scripts\/).+\.(?:sh|bash|zsh)$/.test(cmd)) return { term: cmd, what: t('command.projectScript') };
    if (!cmd || /^(?:do|done|then|fi|esac|else|})$/.test(cmd)) return null;
    if (/^(?:for|while|until|if|case)$/.test(cmd)) return { term: cmd, what: /^(?:for|while|until)$/.test(cmd) ? (en ? 'Repeats commands for a list or condition. Like repeating a recipe for each guest.' : '목록이나 조건에 따라 반복해서 실행해요.') : (en ? 'Chooses commands based on a condition. Like choosing clothes for the weather.' : '조건에 따라 실행할 명령을 골라요.') };
    if (/<<|\n/.test(step) && /^(?:python3?|node|bash|sh)$/.test(cmd)) return { term: cmd, what: `${commands[cmd] || (en ? 'Runs shell commands. Like following a written task list.' : '셸 명령을 실행해요.')} ${en ? '(script body included)' : '(스크립트 본문 포함)'}` };
    if (cmd === 'git') return { term: sub ? `git ${sub}` : cmd, what: withWarning(git[sub] ?? '', warningFor(cmd, sub, args)) };
    if (['npm', 'pnpm', 'yarn', 'bun'].includes(cmd))
      return { term: sub ? `${cmd} ${sub}` : cmd, what: packages[sub] ?? commands[cmd] ?? '' };
    const base = isRecursiveRm(cmd, sub, args) ? (en ? 'Deletes folders and the files inside them. Like throwing away a binder with all its pages.' : '폴더와 그 안의 파일을 함께 지워요.') : commands[cmd] ?? '';
    return { term: cmd, what: withWarning(base, warningFor(cmd, sub, args)) };
  }).filter(Boolean) };
}

export function important(tool, output = '', error = false) {
  if (detectTricks(tool, output, error).length) return true;
  const c = caster(tool, output, error);
  return ['test', 'try'].includes(c.kind) && (c.kind === 'test' && c.score ? c.score.fail > 0 : looksFailed(output, error));
}

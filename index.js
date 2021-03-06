#!/usr/bin/env node
const yargs = require('yargs');
const shell = require('shelljs');
const path = require('path');
const axios = require('axios').default;
const fs = require('fs/promises');
const dataPath = path.join(process.env.HOME, '.easypack');
if(!(shell.which('tar') && shell.which('wget') && shell.which('gzip'))) {
    shell.echo("This tool requires tar, gzip and wget.");
}
const cwd = shell.pwd();
var installURL;
yargs.usage('$0 <command> [args]').command('install <package>', 'Install <package>.', async (args) => {
    args.positional('package', {
        type: 'string',
        describe: 'Package to install. Can be a URL, path or package name.'
    });
}, installURL = async (args, source = "local") => {
    const {repos} = JSON.parse(shell.cat(path.join(dataPath, 'repos.json')));
    if(args.package.startsWith('http://') || args.package.startsWith('https://')) {
        shell.echo(`Downloading ${args.package}...`)
        shell.exec(`wget -O "${path.join(dataPath, 'tmp-pack.tgz')}" "${args.package}"`);
        shell.echo(`Unzipping...`);
        shell.mkdir('-p', path.join(dataPath, 'tmp-unpack'));
        shell.cd(path.join(dataPath, 'tmp-unpack'));
        shell.exec(`tar -xzf ${path.join(dataPath, 'tmp-pack.tgz')}`)
        install(path.join(dataPath, 'tmp-unpack'), source);
        shell.rm('-rf', path.join(dataPath, 'tmp-unpack'));
    } else if(args.package.startsWith('./') || args.package.startsWith('../') || args.package.startsWith('/')) {
        const absPath = path.resolve(args.package);
        shell.echo(`Unzipping...`);
        shell.mkdir('-p', path.join(dataPath, 'tmp-unpack'));
        shell.cd(path.join(dataPath, 'tmp-unpack'));
        shell.exec(`tar -xzf ${absPath}`);
        install(path.join(dataPath, 'tmp-unpack'), source);
        shell.rm('-rf', path.join(dataPath, 'tmp-unpack'));
    } else {
        shell.echo("Getting repository meta...");
        let repoLists = [];
        for(let repo of repos) {
            shell.echo(repo);
            repoLists.push((await axios.get(repo)).data);
        }
        shell.echo("Finding repo for package...");
        const correctRepo = repoLists.find(repo => repo.packages.find(pack => pack.name == args.package) !== undefined);
        if(correctRepo == undefined) {
            shell.echo("Could not find package.");
            shell.exit(42.5);
            return;
        }
        const packURL = correctRepo.packages.find(pack => pack.name == args.package).url;
        installURL({package: packURL}, repos[repoLists.indexOf(correctRepo)]);
    }
    shell.cd(cwd);
}).command('make', 'Make a package according to the values in easypack.json', () => {}, args => {
    const easypack = JSON.parse(shell.cat('./easypack.json'));
    const packFileName = `${easypack.name}@${easypack.version}.easypack.tar`;
    let sourceDir = './'
    if('packDirs' in easypack) sourceDir = easypack.packDirs;
    shell.exec(`tar -cf ${packFileName} ${sourceDir.join(' ')} ./easypack.json`);
    shell.exec(`gzip -f ${packFileName}`);
}).command('uninstall <package>', 'Uninstall a package', args => {
    args.positional('package', {
        describe: 'The package to uninstall (ex. easypack)',
        type: 'string'
    });
}, args => {
    const absPaths = shell.ls(path.join(dataPath, 'packages')).map(package => ({name: package.split('@')[0], packPath: path.join(dataPath, 'packages', package)})).filter(elem => elem.name == args.package).map(elem => elem.packPath);
    absPaths.forEach(absPath => {
        const packdata = JSON.parse(shell.cat(path.join(absPath, 'easypack.json')));
        shell.echo(`Uninstalling ${packdata.name}...`);
        if('bin' in packdata) Object.keys(packdata.bin).forEach(exec => {
            shell.rm(path.join(process.env.HOME, '.local', 'bin', exec));
        });
        if('lib' in packdata) Object.keys(packdata.lib).forEach(exec => {
            shell.rm(path.join(process.env.HOME, '.local', 'lib', exec));
        });
        if('include' in packdata) Object.keys(packdata.include).forEach(exec => {
            shell.rm(path.join(process.env.HOME, '.local', 'include', exec));
        });
        shell.rm('-rf', absPath);
    });
}).command('update <package>', 'Update a package', args => {
    args.positional('package', {
        desc: 'Package to update (without version number)',
        type: 'string'
    });
}, async args => {
    shell.echo('Getting newest version...');
    const packPath = shell.ls(path.join(dataPath, 'packages')).map(package => ({name: package.split('@')[0], packPath: path.join(dataPath, 'packages', package)})).filter(elem => elem.name == args.package).sort(elem, elem2 => elem.packPath.split('@')[1].localeCompare(elem2.packPath.split('@')[1]))[0].packPath;
    const packdata_old = JSON.parse(shell.cat(path.join(packPath, 'easypack.json')));
    const source = packdata_old.source;
    if(source == 'local') {
        shell.echo('Package not installed from repo, cannot update');
        shell.exit(42.5);
        return;
    }
    shell.echo('Downloading meta...');
    const repoJson = (await axios.get(source)).data;
    const packdata_new = repoJson.packages.find(pack => pack.name == args.package);
    if(packdata_old.version == packdata_new.version) {
        shell.echo('Nothing to do!');
        shell.exit(0);
        return;
    }
    shell.echo('Installing new version, switching to install mode...');
    await installURL(packdata_new.url);
}).command("addrepo <url>", "Add a repository", args => {
    args.positional('url', {
        describe: "The URL of the repository to add",
        type: "string"
    });
}, async args => {
    const curRepos = new Set(JSON.parse(shell.cat(path.join(dataPath, 'repos.json'))).repos);
    curRepos.add(args.url);
    await fs.writeFile(path.join(dataPath, 'repos.json'), JSON.stringify({repos: curRepos}), 'utf8');
}).command('init', 'Blow up the universe (reset everything)', () => {}, async () => {
    await fs.writeFile(path.join(dataPath, 'repos.json'), JSON.stringify({
        "repos": [
            "https://munchkinhalfling.github.io/easypkg-repo/repo.json"
        ]
    }));
    // Any other post-install tasks
}).argv;
async function install(dirPath, source = "local") {
    const packdata = JSON.parse(shell.cat(path.join(dirPath, 'easypack.json')));
    packdata.source = source;
    const packagePath = path.join(dataPath, 'packages', packdata.name + '@' + packdata.version);
    shell.mkdir('-p', packagePath);
    shell.mv(dirPath + '/*', packagePath);
    shell.cd(packagePath);
    
    shell.echo(`Installing ${packdata.name} to ${shell.pwd()}...`);
    shell.mkdir('-p', path.join(process.env.HOME, '.local', 'bin'), path.join(process.env.HOME, '.local', 'lib'), path.join(process.env.HOME, '.local', 'include'));
    if('bin' in packdata) Object.keys(packdata.bin).forEach(execName => {
        shell.ln('-s', path.join(packagePath, packdata.bin[execName]), path.join(process.env.HOME, '.local', 'bin', execName));
        shell.chmod(755, path.join(process.env.HOME, '.local', 'bin', execName));
    });
    if('lib' in packdata) Object.keys(packdata.lib).forEach(execName => {
        shell.ln('-s', path.join(packagePath, packdata.lib[execName]), path.join(process.env.HOME, '.local', 'lib', execName));
    });
    if('include' in packdata) Object.keys(packdata.include).forEach(inclName => {
        shell.ln('-s', path.join(packagePath, packdata.include[inclName]), path.join(process.env.HOME, '.local', 'include', inclName));
    });
    await fs.writeFile(path.join(packagePath, 'easypack.json'), JSON.stringify(packdata));
}
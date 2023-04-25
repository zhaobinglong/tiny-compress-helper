#! /usr/bin/env node

const fs = require("fs");
const path = require("path");
const https = require("https");
const URL = require("url").URL;
const chalk = require("chalk");
const log = console.log;
const CG = require("console-grid");

let conf = {
  files: [],
  EntryFolder: "",
  DeepLoop: false,
  Exts: [".jpg", ".png", ".jpeg"],
  Max: 5200000, // 5MB == 5242848.754299136
  index: 0, // 当前处理的图片索引
  table: [], // 输出的结果数据
};

// 获取用户输入的文件夹路径
if (process.argv.length <= 2) {
  log(chalk.red("文件夹获取失败，请在命令中添加文件夹路径参数"));
  return false;
}
// const folder = process.argv[2];

// 开始载入文件
const fullFilePath = process.argv[2];
fileFilter(fullFilePath);

// 异步执行，每次收到回调后再执行下一个，避免触发频率限制🚫
fileUpload();

/**
 * 获取命令执行文件夹
 * 指令 -f
 * 参数 ./
 * 必填，待处理的图片文件夹
 */
function getEntryFolder() {
  let i = process.argv.findIndex((i) => i === "-f");
  if (i === -1 || !process.argv[i + 1]) return err("获取命令执行文件夹：失败");
  return process.argv[i + 1];
}

/**
 * 过滤待处理文件夹，得到待处理文件列表
 * @param {*} folder 待处理文件夹
 * @param {*} files 待处理文件列表
 */
function fileFilter(folder) {
  // 读取文件夹
  fs.readdirSync(folder).forEach((file) => {
    let fullFilePath = path.join(folder, file);
    // 读取文件信息
    let fileStat = fs.statSync(fullFilePath);
    // 过滤文件安全性/大小限制/后缀名
    if (
      fileStat.size <= conf.Max &&
      fileStat.isFile() &&
      conf.Exts.includes(path.extname(file))
    )
      conf.files.push(fullFilePath);
    // 深度递归处理文件夹
    else if (conf.DeepLoop && fileStat.isDirectory()) {
      fileFilter(fullFilePath);
    } else {
      // console.log("do nothing");
    }
  });
}

/**
 * TinyPng 远程压缩 HTTPS 请求的配置生成方法
 */

function getAjaxOptions() {
  return {
    method: "POST",
    hostname: "tinypng.com",
    path: "/backend/opt/shrink",
    headers: {
      rejectUnauthorized: false,
      "X-Forwarded-For": Array(4)
        .fill(1)
        .map(() => parseInt(Math.random() * 254 + 1))
        .join("."),
      "Postman-Token": Date.now(),
      "Cache-Control": "no-cache",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36",
    },
  };
}

/**
 * TinyPng 远程压缩 HTTPS 请求
 * @param {string} img 待处理的文件
 * @success {
 * "input": { "size": 887, "type": "image/png" },
 * "output": { "size": 785, "type": "image/png", "width": 81, "height": 81, "ratio": 0.885, "url": "https://tinypng.com/web/output/7aztz90nq5p9545zch8gjzqg5ubdatd6" }
 *           }
 * @error  {"error": "Bad request", "message" : "Request is invalid"}
 */
function fileUpload() {
  if (conf.index >= conf.files.length) {
    console.log("本次批量压缩结束");
    print(conf.table);
    return false;
  }
  const imgPath = conf.files[conf.index];
  let req = https.request(getAjaxOptions(), (res) => {
    res.on("data", (buf) => {
      let obj = JSON.parse(buf.toString());
      if (obj.error) {
        console.log(`压缩失败！\n 当前文件：${imgPath} \n ${obj.message}`);
      } else {
        if (obj.output.ratio >= 0.9) {
          // 压缩比例过小，属于已经压缩过的文件，不再替换
          console.log("跳过压缩");
          console.log(obj.output);
          conf.index = conf.index + 1;
          fileUpload();
        } else {
          downFile(imgPath, obj);
        }
      }
    });
  });

  req.write(fs.readFileSync(imgPath), "binary");
  req.on("error", (e) =>
    console.error(`请求错误! \n 当前文件：${imgPath} \n`, e)
  );
  req.end();
}

// 该方法被循环调用,请求图片数据
function downFile(entryImgPath, obj) {
  let options = new URL(obj.output.url);
  let req = https.request(options, (res) => {
    let body = "";
    res.setEncoding("binary");
    res.on("data", (data) => (body += data));
    res.on("end", () => {
      fs.writeFile(entryImgPath, body, "binary", (err) => {
        if (err) return console.error(err);
        // let log = `✅压缩成功，`;
        // log += `优化比例: ${((1 - obj.output.ratio) * 100).toFixed(2)}% ，`;
        // log += `原始大小: ${(obj.input.size / 1024).toFixed(2)}KB,`;
        // log += `压缩大小: ${(obj.output.size / 1024).toFixed(2)}KB ,`;
        // log += `文件：${entryImgPath}`;
        // console.log(log);
        conf.table.push({
          path: entryImgPath,
          input: `${(obj.input.size / 1024).toFixed(2)}KB`,
          output: `${(obj.output.size / 1024).toFixed(2)}KB`,
          ratio: `${((1 - obj.output.ratio) * 100).toFixed(2)}%`,
          time: "",
        });
        conf.index = conf.index + 1;
        fileUpload();
      });
    });
  });
  req.on("error", (e) => console.error(e));
  req.end();
}

// 打印表格
function print(table) {
  CG({
    options: {
      headerVisible: true,
    },
    columns: ["名称", "原体积", "现体积", "压缩率", "耗时", "状态"],
    rows: [
      ...table.map((item) => [
        chalk.blue(item.path),
        chalk.red(item.input),
        chalk.green(item.output),
        !item.ratio ? chalk.red("0 %") : chalk.green(item.ratio),
        chalk.cyan(item.time + " ms"),
        item.output ? chalk.green("success") : chalk.red("fail"),
      ]),
    ],
  });
}
